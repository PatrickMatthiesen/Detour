using System.Text.Json;
using Detour.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using ModelContextProtocol.Server;

namespace Detour.Api.Tests;

public sealed class TripMcpToolsTests
{
    [Fact]
    public async Task Partial_tool_updates_preserve_fields_and_explicit_clear_removes_nullable_value()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var initial = await service.GetSnapshotAsync();
        var create = await tools.EditTask(EditOperation.create, "task-test", initial.Version,
            new TripTaskChanges { Title = "Keep title", Scope = "before", Notes = "Keep notes", DueDate = new(2026, 9, 20) });
        Assert.True(create.Success);
        var update = await tools.EditTask(EditOperation.update, "task-test", create.Version,
            new TripTaskChanges { Completed = true }, ["dueDate"]);
        Assert.True(update.Success);
        var task = Assert.Single((await service.GetSnapshotAsync()).Tasks);
        Assert.Equal("Keep title", task.Title);
        Assert.Equal("Keep notes", task.Notes);
        Assert.True(task.Completed);
        Assert.Null(task.DueDate);
        var collision = await tools.EditTask(EditOperation.update, "task-test", update.Version,
            new TripTaskChanges { Title = "Changed" }, ["title"]);
        Assert.False(collision.Success);
        Assert.Equal(update.Version, (await service.GetSnapshotAsync()).Version);
    }

    [Fact]
    public async Task Summary_excludes_library_and_section_reads_page_without_losing_records()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Tasks = Enumerable.Range(0, 27).Select(i => new TripTask { Id = $"task-{i}", Title = $"Task {i}" }).ToList();
        Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var summary = await tools.GetTrip();
        Assert.Equal(27, summary.Data["counts"]!["tasks"]!.GetValue<int>());
        Assert.Null(summary.Data["tasks"]);
        var page = await tools.GetTrip(TripSection.tasks);
        Assert.Equal(25, page.Data.AsArray().Count);
        Assert.Equal(25, page.NextOffset);
        var rest = await tools.GetTrip(TripSection.tasks, offset: page.NextOffset!.Value);
        Assert.Equal(2, rest.Data.AsArray().Count);
        Assert.Null(rest.NextOffset);
        var exact = await tools.GetTrip(TripSection.tasks, id: "task-26");
        Assert.Single(exact.Data.AsArray());
    }

    [Fact]
    public void Catalog_has_typed_changes_structured_responses_and_no_full_trip_write()
    {
        var methods = typeof(TripMcpTools).GetMethods().Where(m => Attribute.IsDefined(m, typeof(McpServerToolAttribute))).ToArray();
        Assert.DoesNotContain(methods, m => m.Name == "ReplaceTrip");
        foreach (var method in methods)
        {
            var tool = McpServerTool.Create(method, (object)new TripMcpTools(null!, null!)).ProtocolTool;
            Assert.NotNull(tool.OutputSchema);
            Assert.False(tool.Annotations!.OpenWorldHint);
            Assert.Equal(method.Name is "GetTrip" or "SearchPlaces", tool.Annotations.ReadOnlyHint);
            if (method.Name == "EditTask")
            {
                var schema = tool.InputSchema.ToString();
                Assert.Contains("completed", schema);
                Assert.Contains("clearFields", schema);
                Assert.Contains("create", schema);
            }
        }
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<TripTaskChanges>("{\"unexpected\":true}", new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    private static TripDbContext CreateDb() => new(new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
    private static TripService CreateService(TripDbContext db)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        return new(db, new OwnerAccessor(new HttpContextAccessor { HttpContext = context },
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AllowLocalDev"] = "true" }).Build()));
    }
}
