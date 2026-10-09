using System.Net;
using Detour.Api;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Hosting;

namespace Detour.Api.Tests;

public sealed class SecurityHeadersTests
{
    [Theory]
    [InlineData("Production", "https://example.test", true, true)]
    [InlineData("Production", "http://example.test", true, false)]
    [InlineData("Development", "https://example.test", false, false)]
    public async Task Headers_cover_documents_and_errors_without_hsts_on_http(string environment, string origin, bool csp, bool hsts)
    {
        using var host = await new HostBuilder().ConfigureWebHost(web => web
            .UseEnvironment(environment).UseTestServer().Configure(app =>
            {
                app.UseSecurityHeaders();
                app.Run(context =>
                {
                    context.Response.StatusCode = context.Request.Path == "/error" ? 401 : 200;
                    return context.Response.WriteAsync("response");
                });
            })).StartAsync();
        using var client = host.GetTestClient();
        client.BaseAddress = new Uri(origin);
        foreach (var path in new[] { "/", "/error" })
        {
            using var response = await client.GetAsync(path);
            Assert.Equal(path == "/error" ? HttpStatusCode.Unauthorized : HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
            Assert.Equal(csp, response.Headers.Contains("Content-Security-Policy"));
            Assert.Equal(hsts, response.Headers.Contains("Strict-Transport-Security"));
            if (csp) Assert.Equal(SecurityHeaders.ContentSecurityPolicy, response.Headers.GetValues("Content-Security-Policy").Single());
        }
    }
}
