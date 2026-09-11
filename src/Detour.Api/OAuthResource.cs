namespace Detour.Api;

internal static class OAuthResource
{
    // Local development without a public URL does not expose OAuth externally.
    public static string GetIdentifier(IConfiguration configuration)
        => new Uri(new Uri(configuration["Auth:PublicUrl"] ?? configuration["Auth:Issuer"] ?? "http://localhost"), "/mcp").AbsoluteUri;
}
