using System.Buffers.Binary;
using System.Net;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace Detour.Api.Tests;

public sealed class PhotoDownloaderTests
{
    private const string TinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    [Theory]
    [InlineData("0.0.0.1")]
    [InlineData("10.0.0.1")]
    [InlineData("100.64.0.1")]
    [InlineData("127.0.0.1")]
    [InlineData("169.254.169.254")]
    [InlineData("172.31.255.255")]
    [InlineData("192.0.0.1")]
    [InlineData("192.31.196.1")]
    [InlineData("192.168.1.1")]
    [InlineData("198.18.0.1")]
    [InlineData("203.0.113.1")]
    [InlineData("224.0.0.1")]
    [InlineData("::1")]
    [InlineData("::ffff:127.0.0.1")]
    [InlineData("64:ff9b::7f00:1")]
    [InlineData("64:ff9b:1::808:808")]
    [InlineData("fec0::1")]
    [InlineData("ff02::1")]
    [InlineData("2001:db8::1")]
    [InlineData("2002:808:808::1")]
    public void Special_purpose_addresses_are_not_public(string value)
        => Assert.False(PhotoDownloader.IsPublic(IPAddress.Parse(value)));

    [Theory]
    [InlineData("1.1.1.1")]
    [InlineData("8.8.8.8")]
    [InlineData("2001:4860:4860::8888")]
    [InlineData("2606:4700:4700::1111")]
    [InlineData("::ffff:8.8.8.8")]
    public void Global_unicast_addresses_are_public(string value)
        => Assert.True(PhotoDownloader.IsPublic(IPAddress.Parse(value)));

    [Fact]
    public async Task Normalization_decodes_only_the_first_animation_frame()
    {
        await using var input = new MemoryStream();
        using (var animation = new Image<Rgba32>(2, 2, Color.Red))
        using (var second = new Image<Rgba32>(2, 2, Color.Blue))
        {
            animation.Frames.AddFrame(second.Frames.RootFrame);
            await animation.SaveAsGifAsync(input);
        }
        input.Position = 0;

        using var normalized = await PhotoDownloader.NormalizeAsync(input, CancellationToken.None);
        using var output = await Image.LoadAsync<Rgba32>(normalized.Content);

        Assert.Single(output.Frames);
        Assert.Equal("image/jpeg", normalized.ContentType);
        Assert.True(output[0, 0].R > output[0, 0].B);
    }

    [Fact]
    public async Task Oversized_dimensions_are_rejected_before_pixel_decode()
    {
        await using var input = new MemoryStream(PngWithDimensions(10_000, 5_000));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PhotoDownloader.NormalizeAsync(input, CancellationToken.None));

        Assert.Contains("dimensions", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Compressed_input_over_ten_megabytes_is_rejected()
    {
        await using var input = new MemoryStream(new byte[PhotoDownloader.MaxDownloadBytes + 1]);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PhotoDownloader.NormalizeAsync(input, CancellationToken.None));

        Assert.Contains("larger than 10 MB", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Normalization_has_an_independent_timeout()
    {
        await using var input = new NeverEndingStream();

        var error = await Assert.ThrowsAsync<TimeoutException>(() =>
            PhotoDownloader.NormalizeAsync(input, TimeSpan.FromMilliseconds(25), CancellationToken.None));

        Assert.Contains("timed out", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Caller_cancellation_is_preserved()
    {
        await using var input = new NeverEndingStream();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(25));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            PhotoDownloader.NormalizeAsync(input, TimeSpan.FromSeconds(5), cancellation.Token));
    }

    [Fact]
    public async Task Valid_image_is_normalized_to_jpeg()
    {
        await using var input = new MemoryStream(Convert.FromBase64String(TinyPng));

        using var normalized = await PhotoDownloader.NormalizeAsync(input, CancellationToken.None);

        Assert.Equal("image/jpeg", normalized.ContentType);
        Assert.True(normalized.Length > 0);
    }

    private static byte[] PngWithDimensions(int width, int height)
    {
        var png = Convert.FromBase64String(TinyPng);
        BinaryPrimitives.WriteInt32BigEndian(png.AsSpan(16, 4), width);
        BinaryPrimitives.WriteInt32BigEndian(png.AsSpan(20, 4), height);
        BinaryPrimitives.WriteUInt32BigEndian(png.AsSpan(29, 4), Crc32(png.AsSpan(12, 17)));
        return png;
    }

    private static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        var crc = uint.MaxValue;
        foreach (var value in bytes)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc >> 1) ^ (0xedb88320u & (uint)-(int)(crc & 1));
        }
        return ~crc;
    }

    private sealed class NeverEndingStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return 0;
        }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
