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

public sealed class PlacePhotoRow
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public string PlaceId { get; set; } = "";
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "image/jpeg";
    public long Length { get; set; }
    public string? SourceUrl { get; set; }
    public string? Author { get; set; }
    public string? Caption { get; set; }
    public string Kind { get; set; } = "place";
    public string? License { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class PhotoObjectDeletion
{
    public string ObjectKey { get; set; } = "";
    public DateTimeOffset NotBefore { get; set; }
}

// Google Places coordinates expire separately from the user's trip document.
public sealed class GooglePlaceLocationRow
{
    public string OwnerId { get; set; } = "";
    public string PlaceId { get; set; } = "";
    public string MapsUrl { get; set; } = "";
    public string Query { get; set; } = "";
    public string GooglePlaceId { get; set; } = "";
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset RefreshAfter { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class TripDbContext(DbContextOptions<TripDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<TripDocumentRow> Trips => Set<TripDocumentRow>();
    public DbSet<PlacePhotoRow> PlacePhotos => Set<PlacePhotoRow>();
    public DbSet<PhotoObjectDeletion> PhotoObjectDeletions => Set<PhotoObjectDeletion>();
    public DbSet<GooglePlaceLocationRow> GooglePlaceLocations => Set<GooglePlaceLocationRow>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.UseOpenIddict();
        modelBuilder.Entity<GooglePlaceLocationRow>(entity =>
        {
            entity.HasKey(x => new { x.OwnerId, x.PlaceId });
            entity.Property(x => x.OwnerId).HasMaxLength(200);
            entity.Property(x => x.PlaceId).HasMaxLength(200);
            entity.Property(x => x.MapsUrl).HasMaxLength(2048);
            entity.Property(x => x.Query).HasMaxLength(2048);
            entity.Property(x => x.GooglePlaceId).HasMaxLength(500);
            entity.Property(x => x.Revision).IsConcurrencyToken();
            entity.HasIndex(x => x.ExpiresAt);
        });
        modelBuilder.Entity<PhotoObjectDeletion>(entity =>
        {
            entity.HasKey(x => x.ObjectKey);
            entity.Property(x => x.ObjectKey).HasMaxLength(500);
        });
        modelBuilder.Entity<TripDocumentRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.OwnerId).IsUnique();
            entity.Property(x => x.OwnerId).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Json).HasColumnType("jsonb");
            entity.Property(x => x.Version).IsConcurrencyToken();
        });
        modelBuilder.Entity<PlacePhotoRow>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.OwnerId, x.PlaceId }).IsUnique();
            entity.Property(x => x.OwnerId).HasMaxLength(200).IsRequired();
            entity.Property(x => x.PlaceId).HasMaxLength(200).IsRequired();
            entity.Property(x => x.ObjectKey).HasMaxLength(500).IsRequired();
            entity.Property(x => x.ContentType).HasMaxLength(100).IsRequired();
            entity.Property(x => x.Kind).HasMaxLength(32).IsRequired();
            entity.Property(x => x.SourceUrl).HasMaxLength(2048);
            entity.Property(x => x.Author).HasMaxLength(500);
            entity.Property(x => x.Caption).HasMaxLength(500);
            entity.Property(x => x.License).HasMaxLength(500);
        });
    }
}
