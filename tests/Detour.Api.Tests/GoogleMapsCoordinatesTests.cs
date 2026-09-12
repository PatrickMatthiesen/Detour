using System.Net;
using Detour.Api;

namespace Detour.Api.Tests;

public sealed class GoogleMapsCoordinatesTests
{
    [Theory]
    [InlineData("https://www.google.com/maps/search/?api=1&query=35.681236%2C139.767125", 35.681236, 139.767125)]
    [InlineData("https://maps.google.co.jp/maps/search/?api=1&q=35.1852%2C137.0867", 35.1852, 137.0867)]
    public void Parses_url_encoded_query_coordinate_pairs(string url, double latitude, double longitude)
    {
        var point = Assert.IsType<GoogleMapsCoordinates.Point>(GoogleMapsCoordinates.Parse(url));

        Assert.Equal(latitude, point.Latitude);
        Assert.Equal(longitude, point.Longitude);
    }

    [Fact]
    public void Parses_a_single_place_pin_and_ignores_camera_coordinates()
    {
        var url = "https://www.google.com/maps/place/Ghibli+Park/@35.1852,137.0867,17z/data=!3m1!4b1!4m5!3m4!1s0x6004b7!8m2!3d35.1852!4d137.0867";

        var point = Assert.IsType<GoogleMapsCoordinates.Point>(GoogleMapsCoordinates.Parse(url));

        Assert.Equal(35.1852, point.Latitude);
        Assert.Equal(137.0867, point.Longitude);
        Assert.Null(GoogleMapsCoordinates.Parse("https://www.google.com/maps/@35.1852,137.0867,17z"));
    }

    [Theory]
    [InlineData("https://www.google.com/maps/place/Ghibli+Park")]
    [InlineData("https://www.google.com/maps/search/?api=1&query=91%2C139")]
    [InlineData("https://www.google.com/maps/search/?api=1&query=35%2Cbad")]
    [InlineData("https://www.google.com/maps/search/?api=1&query=35%2C139&query=36%2C140")]
    [InlineData("https://www.google.com/maps/dir/?api=1&destination=35%2C139")]
    public void Rejects_name_camera_invalid_multi_point_and_direction_urls(string url)
    {
        Assert.Null(GoogleMapsCoordinates.Parse(url));
    }

    [Fact]
    public void Rejects_urls_outside_the_google_maps_allowlist()
    {
        Assert.Null(GoogleMapsCoordinates.Parse("https://evil.example/maps/search/?query=35%2C139"));
        Assert.Null(GoogleMapsCoordinates.Parse("https://www.google.com.evil.example/maps/search/?query=35%2C139"));
        Assert.Null(GoogleMapsCoordinates.Parse("http://www.google.com/maps/search/?query=35%2C139"));
        Assert.Null(GoogleMapsCoordinates.Parse("https://maps.google.com/not-maps?query=35%2C139"));
    }

    [Theory]
    [InlineData("google.com/maps/search/?api=1&query=ASICS%20RUN%20TOKYO%20MARUNOUCHI%20Marunouchi%20%2F%20Imperial%20Palace%20Japan", "ASICS RUN TOKYO MARUNOUCHI Marunouchi / Imperial Palace Japan")]
    [InlineData("https://www.google.com/maps/search/?api=1&query=Nakiryu%20(%E9%B3%B4%E9%BE%8D)%20Minamiotsuka%2C%20Toshima%20Japan", "Nakiryu (鳴龍) Minamiotsuka, Toshima Japan")]
    public void Extracts_the_users_name_only_search_queries(string url, string expected)
        => Assert.Equal(expected, GoogleMapsCoordinates.SearchQuery(url));

    [Fact]
    public async Task Resolves_a_short_maps_link_through_a_whitelisted_redirect()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Found)
        {
            Headers = { Location = new Uri("https://www.google.com/maps/search/?api=1&query=35.681236%2C139.767125") }
        }));
        using var client = new HttpClient(handler);
        var resolver = new GoogleMapsCoordinates(client);

        var point = await resolver.ResolveAsync("https://maps.app.goo.gl/example", CancellationToken.None);

        Assert.Equal(new GoogleMapsCoordinates.Point(35.681236, 139.767125), point);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task Blocks_a_short_link_redirect_to_an_untrusted_domain()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Found)
        {
            Headers = { Location = new Uri("https://evil.example/place?query=35%2C139") }
        }));
        using var client = new HttpClient(handler);
        var resolver = new GoogleMapsCoordinates(client);

        var point = await resolver.ResolveAsync("https://maps.app.goo.gl/example", CancellationToken.None);

        Assert.Null(point);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task Returns_null_when_short_link_expansion_fails()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("network failure")));
        using var client = new HttpClient(handler);
        var resolver = new GoogleMapsCoordinates(client);

        var point = await resolver.ResolveAsync("https://maps.app.goo.gl/example", CancellationToken.None);

        Assert.Null(point);
    }

    [Fact]
    public async Task Returns_null_when_short_link_expansion_times_out()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromException<HttpResponseMessage>(new TaskCanceledException("request timed out")));
        using var client = new HttpClient(handler);
        var resolver = new GoogleMapsCoordinates(client);

        var point = await resolver.ResolveAsync("https://maps.app.goo.gl/example", CancellationToken.None);

        Assert.Null(point);
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return responder(request, cancellationToken);
        }
    }
}
