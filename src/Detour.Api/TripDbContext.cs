using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;

namespace Detour.Api;

public sealed class ApplicationUser : IdentityUser { }

public sealed class TripDocumentRow
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public long Version { get; set; }
    public string Json { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class TripDbContext(DbContextOptions<TripDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<TripDocumentRow> Trips => Set<TripDocumentRow>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.UseOpenIddict();
        modelBuilder.Entity<TripDocumentRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.OwnerId).IsUnique();
            entity.Property(x => x.OwnerId).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Json).HasColumnType("jsonb");
            entity.Property(x => x.Version).IsConcurrencyToken();
        });
    }
}
