using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Detour.Api;

/// <summary>Allows EF tooling to inspect the complete Identity/OpenIddict model without starting the web host.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<TripDbContext>
{
    public TripDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("TripAdvisor__DesignConnection")
            ?? "Host=localhost;Database=tripadvisor_design;Username=postgres;Password=postgres";
        var options = new DbContextOptionsBuilder<TripDbContext>().UseNpgsql(connection).Options;
        return new TripDbContext(options);
    }
}
