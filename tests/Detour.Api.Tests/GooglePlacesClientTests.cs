using System.Net;
using System.Text;
using System.Text.Json;
using Detour.Api;
using Microsoft.Extensions.Configuration;

namespace Detour.Api.Tests;

public sealed class GooglePlacesClientTests
{
    [Fact]
    public async Task Place_id_uses_details_and_validates_identity()
    {
        using var handler = new RecordingHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal("https://places.googleapis.com/v1/places/abc", request.RequestUri!.AbsoluteUri);
            Assert.Equal("id,location", request.Headers.GetValues("X-Goog-FieldMask").Single());
            return Task.FromResult(JsonResponse("""{"id":"abc","location":{"latitude":35,"longitude":139}}"""));
        });
        Assert.Equal(new GooglePlacesResult("abc", 35, 139), await CreateClient(handler).GetAsync("abc"));
    }

    [Fact]
    public async Task Sends_text_search_with_key_and_minimal_field_mask()
    {
        using var handler = new RecordingHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://places.googleapis.com/v1/places:searchText", request.RequestUri!.AbsoluteUri);
            Assert.Equal("test-key", request.Headers.GetValues("X-Goog-Api-Key").Single());
            Assert.Equal("places.id,places.displayName,places.formattedAddress,places.location,nextPageToken", request.Headers.GetValues("X-Goog-FieldMask").Single());
            Assert.DoesNotContain("test-key", request.RequestUri.Query);
            return Task.FromResult(JsonResponse("""
                {"places":[{"id":"places/abc","location":{"latitude":35.7286762,"longitude":139.7303427}}]}
                """));
        });
        var client = CreateClient(handler);

        var result = await client.SearchAsync("Nakiryu (鳴龍), Minamiotsuka, Toshima Japan");

        Assert.Equal(new GooglePlacesResult("places/abc", 35.7286762, 139.7303427), result);
        var body = Assert.Single(handler.Bodies);
        using var json = JsonDocument.Parse(body);
        Assert.Equal("Nakiryu (鳴龍), Minamiotsuka, Toshima Japan", json.RootElement.GetProperty("textQuery").GetString());
        Assert.Equal(2, json.RootElement.GetProperty("pageSize").GetInt32());
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task Rejects_no_results_without_exposing_response_body()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromResult(JsonResponse("""
            {"error":{"message":"secret upstream details"}}
            """)));
        var client = CreateClient(handler);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => client.SearchAsync("unknown"));

        Assert.Contains("no matching place", exception.Message);
        Assert.DoesNotContain("secret upstream details", exception.Message);
    }

    [Fact]
    public async Task Rejects_multiple_places_and_next_page_as_ambiguous()
    {
        using var multipleHandler = new RecordingHandler((_, _) => Task.FromResult(JsonResponse("""
            {"places":[{"id":"places/a","location":{"latitude":35,"longitude":139}},{"id":"places/b","location":{"latitude":36,"longitude":140}}]}
            """)));
        var multipleClient = CreateClient(multipleHandler);
        var multiple = await Assert.ThrowsAsync<LocationAmbiguousException>(() => multipleClient.SearchAsync("station"));
        Assert.Contains("multiple possible places", multiple.Message);
        Assert.Equal(2, multiple.Candidates.Count);
        Assert.Equal("places/a", multiple.Candidates[0].PlaceId);
        Assert.Contains("specific Google Maps link", multiple.Message);

        using var pageHandler = new RecordingHandler((_, _) => Task.FromResult(JsonResponse("""
            {"places":[{"id":"places/a","location":{"latitude":35,"longitude":139}}],"nextPageToken":"more"}
            """)));
        var pageClient = CreateClient(pageHandler);
        var page = await Assert.ThrowsAsync<LocationAmbiguousException>(() => pageClient.SearchAsync("station"));
        Assert.Contains("multiple possible places", page.Message);
    }

    [Fact]
    public async Task Rejects_missing_or_invalid_place_data()
    {
        foreach (var body in new[]
        {
            "{}",
            "{\"places\":[{\"id\":\"places/a\",\"location\":{\"latitude\":91,\"longitude\":139}}]}",
            "{\"places\":[{\"location\":{\"latitude\":35,\"longitude\":139}}]}",
            "{\"places\":[{\"id\":\"places/a\",\"location\":{\"latitude\":35}}]}",
            "{\"places\":[{\"id\":\"places/a\",\"location\":{\"longitude\":139}}]}",
            "{\"places\":[null]}"
        })
        {
            using var handler = new RecordingHandler((_, _) => Task.FromResult(JsonResponse(body)));
            var client = CreateClient(handler);

            var exception = await Assert.ThrowsAsync<ArgumentException>(() => client.SearchAsync("place"));

            Assert.Contains("specific Google Maps link", exception.Message);
        }
    }

    [Fact]
    public async Task Rejects_an_oversized_response_and_place_id()
    {
        var oversized = "{" + new string('x', 70 * 1024) + "}";
        using var oversizedHandler = new RecordingHandler((_, _) => Task.FromResult(JsonResponse(oversized)));
        var oversizedClient = CreateClient(oversizedHandler);

        var oversizedException = await Assert.ThrowsAsync<ArgumentException>(() => oversizedClient.SearchAsync("place"));

        Assert.Contains("invalid response", oversizedException.Message);

        var longId = new string('a', 501);
        using var idHandler = new RecordingHandler((_, _) => Task.FromResult(JsonResponse($"{{\"places\":[{{\"id\":\"{longId}\",\"location\":{{\"latitude\":35,\"longitude\":139}}}}]}}")));
        var idClient = CreateClient(idHandler);

        var idException = await Assert.ThrowsAsync<ArgumentException>(() => idClient.SearchAsync("place"));

        Assert.Contains("incomplete place", idException.Message);
    }

    [Fact]
    public async Task Rejects_a_query_over_the_bound()
    {
        using var handler = new RecordingHandler((_, _) => throw new InvalidOperationException("must not send"));
        var client = CreateClient(handler);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => client.SearchAsync(new string('q', 2049)));

        Assert.Contains("too long", exception.Message);
        Assert.Empty(handler.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "API key")]
    [InlineData(HttpStatusCode.TooManyRequests, "quota")]
    [InlineData(HttpStatusCode.BadGateway, "lookup failed")]
    public async Task Converts_upstream_status_to_safe_actionable_failure(HttpStatusCode statusCode, string expected)
    {
        using var handler = new RecordingHandler((_, _) => Task.FromResult(new HttpResponseMessage(statusCode)
        {
            Content = new StringContent("secret key and response body")
        }));
        var client = CreateClient(handler);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => client.SearchAsync("place"));

        Assert.Contains(expected, exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret key", exception.Message);
        Assert.DoesNotContain("response body", exception.Message);
    }

    [Fact]
    public async Task Does_not_send_a_request_without_configuration()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromException<HttpResponseMessage>(new InvalidOperationException("must not send")));
        var client = CreateClient(handler, apiKey: null);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => client.SearchAsync("place"));

        Assert.Contains("GoogleMaps:ApiKey", exception.Message);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Propagates_caller_cancellation()
    {
        using var handler = new RecordingHandler(async (_, token) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return JsonResponse("{}");
        });
        var client = CreateClient(handler);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.SearchAsync("place", cancellation.Token));
    }

    [Fact]
    public async Task Converts_network_failure_to_safe_actionable_failure()
    {
        using var handler = new RecordingHandler((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("secret network details")));
        var client = CreateClient(handler);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => client.SearchAsync("place"));

        Assert.Contains("could not reach Google", exception.Message);
        Assert.Contains("specific Google Maps link", exception.Message);
        Assert.DoesNotContain("secret network details", exception.Message);
    }

    private static GooglePlacesClient CreateClient(HttpMessageHandler handler, string? apiKey = "test-key")
    {
        var http = new HttpClient(handler);
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["GoogleMaps:ApiKey"] = apiKey })
            .Build();
        return new GooglePlacesClient(http, configuration);
    }

    private static HttpResponseMessage JsonResponse(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder;

        public List<HttpRequestMessage> Requests { get; } = [];
        public List<string> Bodies { get; } = [];

        public RecordingHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder)
        {
            this.responder = responder;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            return await responder(request, cancellationToken);
        }
    }
}
