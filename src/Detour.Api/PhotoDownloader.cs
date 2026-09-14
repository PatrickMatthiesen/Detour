using System.Net;
using System.Net.Sockets;
using System.Buffers;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace Detour.Api;

public sealed record DownloadedPhoto(Stream Content, string ContentType, long Length) : IDisposable
{
    public void Dispose() => Content.Dispose();
}

public sealed class PhotoDownloader(IHttpClientFactory clients)
{
    public const long MaxDownloadBytes = 10 * 1024 * 1024;
    private const long MaxDecodedPixels = 40_000_000;
    private static readonly TimeSpan NormalizationTimeout = TimeSpan.FromSeconds(30);
    private static readonly string[] ImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        MaxResponseHeadersLength = 32,
        ConnectCallback = async (context, cancellationToken) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
            var address = addresses.FirstOrDefault(IsPublic) ?? throw new PhotoImportException("invalid_photo_url", "The image source resolved to a private or local address.");
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
            try
            {
                await socket.ConnectAsync(address, context.DnsEndPoint.Port, cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch { socket.Dispose(); throw; }
        }
    };

    public async Task<DownloadedPhoto> DownloadAsync(string value, CancellationToken cancellationToken)
    {
        var uri = ValidateUri(value);
        using var client = clients.CreateClient("photo-import");
        for (var redirects = 0; ; redirects++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
            {
                if (redirects >= 4) throw new PhotoImportException("too_many_redirects", "The image source redirected too many times.");
                uri = ValidateUri(new Uri(uri, location).ToString());
                continue;
            }
            response.EnsureSuccessStatusCode();
            var contentType = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
            if (contentType is null || !ImageTypes.Contains(contentType, StringComparer.Ordinal))
                throw new PhotoImportException("unsupported_content_type", "The image source did not return a supported image content type.");
            if (response.Content.Headers.ContentLength is > MaxDownloadBytes)
                throw new PhotoImportException("too_large", "The image source is larger than 10 MB.");

            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
            return await NormalizeAsync(source, cancellationToken);
        }
    }

    public static Task<DownloadedPhoto> NormalizeAsync(Stream source, CancellationToken cancellationToken) =>
        NormalizeAsync(source, NormalizationTimeout, cancellationToken);

    public static async Task<DownloadedPhoto> NormalizeAsync(Stream source, TimeSpan timeout, CancellationToken cancellationToken)
    {
        if (timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        var processingToken = timeoutSource.Token;
        try
        {
            await using var buffer = await ReadBoundedAsync(source, processingToken);
            var decoderOptions = new DecoderOptions { MaxFrames = 1 };
            var info = await Image.IdentifyAsync(decoderOptions, buffer, processingToken) ?? throw new PhotoImportException("invalid_image", "The image source is not a valid image.");
            if ((long)info.Width * info.Height > MaxDecodedPixels) throw new PhotoImportException("too_large", "The image dimensions are too large.");
            buffer.Position = 0;
            using var image = await Image.LoadAsync(decoderOptions, buffer, processingToken);
            image.Mutate(x => x.AutoOrient());
            image.Metadata.ExifProfile = null;
            image.Metadata.XmpProfile = null;
            image.Metadata.IptcProfile = null;
            if (image.Width > 1600 || image.Height > 1600)
                image.Mutate(x => x.Resize(new ResizeOptions { Mode = ResizeMode.Max, Size = new Size(1600, 1600) }));
            var output = new MemoryStream();
            try
            {
                await image.SaveAsJpegAsync(output, new JpegEncoder { Quality = 85 }, processingToken);
                output.Position = 0;
                return new DownloadedPhoto(output, "image/jpeg", output.Length);
            }
            catch
            {
                await output.DisposeAsync();
                throw;
            }
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested && timeoutSource.IsCancellationRequested)
        {
            throw new TimeoutException("Image normalization timed out.", ex);
        }
    }

    public static Uri ValidateUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0 || uri.Port is not (-1 or 80 or 443))
            throw new PhotoImportException("invalid_photo_url", "Image URLs must use HTTP or HTTPS on port 80 or 443 and must not contain credentials.");
        if (uri.HostNameType == UriHostNameType.Dns && string.IsNullOrWhiteSpace(uri.DnsSafeHost))
            throw new PhotoImportException("invalid_photo_url", "The image URL host is invalid.");
        if (IPAddress.TryParse(uri.Host, out var address) && !IsPublic(address))
            throw new PhotoImportException("invalid_photo_url", "Private and local image URLs are not allowed.");
        return uri;
    }

    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) return IsPublic(address.MapToIPv4());
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
            return IsPublicIPv4(bytes);
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return false;

        // Public IPv6 unicast allocations currently live in 2000::/3. Keep
        // transition, documentation and other special-purpose blocks closed.
        if ((bytes[0] & 0xe0) != 0x20) return false;
        return !(
            IsPrefix(bytes, [0x20, 0x01, 0x00], 23) ||       // IETF protocol assignments
            IsPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) || // documentation
            IsPrefix(bytes, [0x20, 0x02], 16) ||             // 6to4 embeds IPv4
            IsPrefix(bytes, [0x3f, 0xff, 0x00], 20));              // documentation
    }

    private static bool IsPublicIPv4(ReadOnlySpan<byte> bytes)
    {
        return !(
            bytes[0] is 0 or 10 or 127 ||
            bytes[0] == 100 && (bytes[1] & 0xc0) == 0x40 || // carrier-grade NAT
            bytes[0] == 169 && bytes[1] == 254 ||
            bytes[0] == 172 && bytes[1] is >= 16 and <= 31 ||
            bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0 ||
            bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 2 ||
            bytes[0] == 192 && bytes[1] == 31 && bytes[2] == 196 ||
            bytes[0] == 192 && bytes[1] == 52 && bytes[2] == 193 ||
            bytes[0] == 192 && bytes[1] == 88 && bytes[2] == 99 ||
            bytes[0] == 192 && bytes[1] == 168 ||
            bytes[0] == 192 && bytes[1] == 175 && bytes[2] == 48 ||
            bytes[0] == 198 && bytes[1] is 18 or 19 ||
            bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100 ||
            bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113 ||
            bytes[0] >= 224);
    }

    private static bool IsPrefix(ReadOnlySpan<byte> address, ReadOnlySpan<byte> prefix, int prefixLength)
    {
        var fullBytes = prefixLength / 8;
        if (!address[..fullBytes].SequenceEqual(prefix[..fullBytes])) return false;
        var remainingBits = prefixLength % 8;
        if (remainingBits == 0) return true;
        var mask = (byte)(0xff << (8 - remainingBits));
        return (address[fullBytes] & mask) == (prefix[fullBytes] & mask);
    }

    private static async Task<MemoryStream> ReadBoundedAsync(Stream source, CancellationToken cancellationToken)
    {
        var result = new MemoryStream();
        var rented = ArrayPool<byte>.Shared.Rent(81920);
        try
        {
            while (true)
            {
                var remaining = MaxDownloadBytes - result.Length;
                var count = (int)Math.Min(rented.Length, remaining + 1);
                var read = await source.ReadAsync(rented.AsMemory(0, count), cancellationToken);
                if (read == 0) break;
                if (read > remaining) throw new PhotoImportException("too_large", "The image source is larger than 10 MB.");
                await result.WriteAsync(rented.AsMemory(0, read), cancellationToken);
            }
            result.Position = 0;
            return result;
        }
        catch
        {
            await result.DisposeAsync();
            throw;
        }
        finally { ArrayPool<byte>.Shared.Return(rented); }
    }
}
