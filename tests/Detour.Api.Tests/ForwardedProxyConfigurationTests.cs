using System.Net;
using System.Net.Http.Json;
using Detour.Api;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Detour.Api.Tests;

public sealed class ForwardedProxyConfigurationTests
{
    [Fact]
    public async Task Forwards_client_ip_and_scheme_only_from_configured_proxy()
    {
        var trusted = await SendRequestAsync("192.168.1.151");
        Assert.Equal("203.0.113.42", trusted.RemoteIpAddress);
        Assert.Equal("https", trusted.Scheme);
        Assert.Equal("localhost", trusted.Host);

        var untrusted = await SendRequestAsync("192.168.1.152");
        Assert.Equal("192.168.1.152", untrusted.RemoteIpAddress);
        Assert.Equal("http", untrusted.Scheme);
        Assert.Equal("localhost", untrusted.Host);
    }

    [Fact]
    public void Invalid_trusted_proxy_address_fails_configuration()
    {
        var options = new ForwardedHeadersOptions();

        var exception = Assert.Throws<InvalidOperationException>(() =>
            ForwardedProxyConfiguration.Configure(options, ["nginx.internal"]));

        Assert.Contains("Auth:TrustedProxies", exception.Message);
    }

    private static async Task<RequestState> SendRequestAsync(string proxyAddress)
    {
        using var host = await new HostBuilder().ConfigureWebHost(web => web
            .UseTestServer()
            .ConfigureServices(services => services.Configure<ForwardedHeadersOptions>(options =>
                ForwardedProxyConfiguration.Configure(options, ["192.168.1.151"])))
            .Configure(app =>
            {
                app.Use(async (context, next) =>
                {
                    context.Connection.RemoteIpAddress = IPAddress.Parse(proxyAddress);
                    await next();
                });
                app.UseForwardedHeaders();
                app.Run(context => context.Response.WriteAsJsonAsync(new RequestState(
                    context.Connection.RemoteIpAddress?.ToString() ?? "null",
                    context.Request.Scheme,
                    context.Request.Host.Host)));
            })).StartAsync();

        using var client = host.GetTestClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "http://localhost/");
        request.Headers.TryAddWithoutValidation("X-Forwarded-For", "203.0.113.42");
        request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");
        request.Headers.TryAddWithoutValidation("X-Forwarded-Host", "attacker.example");
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<RequestState>())!;
    }

    private sealed record RequestState(string RemoteIpAddress, string Scheme, string Host);
}
