using System.Data.Common;
using Amazon.S3;
using Amazon.S3.Model;

namespace Detour.Api;

public sealed record PhotoObject(Stream Content, string ContentType, long Length);

public interface IPhotoObjectStore
{
    Task PutAsync(string objectKey, Stream content, string contentType, long length, CancellationToken cancellationToken);
    Task<PhotoObject?> GetAsync(string objectKey, CancellationToken cancellationToken);
    Task DeleteAsync(string objectKey, CancellationToken cancellationToken);
}

public sealed class S3PhotoObjectStore(IAmazonS3 client, string bucket) : IPhotoObjectStore, IDisposable
{
    public async Task PutAsync(string objectKey, Stream content, string contentType, long length, CancellationToken cancellationToken)
    {
        var request = new PutObjectRequest
        {
            BucketName = bucket,
            Key = objectKey,
            InputStream = content,
            ContentType = contentType,
            AutoCloseStream = false,
            UseChunkEncoding = false
        };
        request.Headers.ContentLength = length;
        await client.PutObjectAsync(request, cancellationToken);
    }

    public async Task<PhotoObject?> GetAsync(string objectKey, CancellationToken cancellationToken)
    {
        try
        {
            var response = await client.GetObjectAsync(new GetObjectRequest { BucketName = bucket, Key = objectKey }, cancellationToken);
            return new PhotoObject(response.ResponseStream, response.Headers.ContentType ?? "application/octet-stream", response.ContentLength);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public Task DeleteAsync(string objectKey, CancellationToken cancellationToken) =>
        client.DeleteObjectAsync(new DeleteObjectRequest { BucketName = bucket, Key = objectKey }, cancellationToken);

    public static S3PhotoObjectStore Create(string connectionString)
    {
        var values = new DbConnectionStringBuilder { ConnectionString = connectionString };
        static string Required(DbConnectionStringBuilder values, string key) =>
            values.TryGetValue(key, out var value) && value is string text && !string.IsNullOrWhiteSpace(text)
                ? text : throw new InvalidOperationException($"The photo storage connection string is missing '{key}'.");
        var endpoint = Required(values, "ServiceUrl");
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new InvalidOperationException("The photo storage ServiceUrl must be an absolute HTTP or HTTPS URL.");
        var config = new AmazonS3Config
        {
            ServiceURL = endpoint,
            AuthenticationRegion = Required(values, "Region"),
            ForcePathStyle = values.TryGetValue("ForcePathStyle", out var force) && bool.TryParse(force?.ToString(), out var parsed) && parsed,
            UseHttp = uri.Scheme == Uri.UriSchemeHttp
        };
        return new S3PhotoObjectStore(new AmazonS3Client(Required(values, "AccessKeyId"), Required(values, "SecretAccessKey"), config), Required(values, "BucketName"));
    }

    public void Dispose() => client.Dispose();
}

public sealed class PhotoStorageUnavailableException(string message) : Exception(message);

public sealed class UnavailablePhotoObjectStore : IPhotoObjectStore
{
    private static Exception Error() => new PhotoStorageUnavailableException("Photo storage is not configured. Add the Aspire photos bucket connection string.");
    public Task PutAsync(string objectKey, Stream content, string contentType, long length, CancellationToken cancellationToken) => Task.FromException(Error());
    public Task<PhotoObject?> GetAsync(string objectKey, CancellationToken cancellationToken) => Task.FromException<PhotoObject?>(Error());
    public Task DeleteAsync(string objectKey, CancellationToken cancellationToken) => Task.FromException(Error());
}
