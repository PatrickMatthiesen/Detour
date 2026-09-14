namespace Detour.Api;

internal static class PhotoDiagnostics
{
    public static bool IsExpected(Exception ex) => ex is InvalidOperationException or HttpRequestException or TimeoutException or OperationCanceledException
        or SixLabors.ImageSharp.UnknownImageFormatException or SixLabors.ImageSharp.InvalidImageContentException
        or PhotoStorageUnavailableException or Amazon.S3.AmazonS3Exception;

    public static EditDiagnostic From(Exception ex) => ex switch
    {
        PhotoImportException photo => new(photo.Code, photo.Message),
        PhotoStorageUnavailableException or Amazon.S3.AmazonS3Exception => new("storage_unavailable", "Photo storage is unavailable."),
        HttpRequestException { StatusCode: { } status } => new($"http_{(int)status}", $"The image source returned HTTP {(int)status}. Choose another image URL."),
        HttpRequestException => new("download_failed", "The image could not be downloaded. Check the source or try another URL."),
        TimeoutException or OperationCanceledException => new("timeout", "Photo import timed out."),
        SixLabors.ImageSharp.UnknownImageFormatException or SixLabors.ImageSharp.InvalidImageContentException => new("invalid_image", "The downloaded data is not a valid supported image."),
        _ => new("invalid_photo", "The photo URL or metadata is invalid. Check URL restrictions and metadata limits.")
    };
}

public sealed class PhotoImportException(string code, string message) : InvalidOperationException(message)
{
    public string Code => code;
}
