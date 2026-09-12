using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Detour.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGooglePlaceLocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GooglePlaceLocations",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PlaceId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    MapsUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    Query = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    GooglePlaceId = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Latitude = table.Column<double>(type: "double precision", nullable: true),
                    Longitude = table.Column<double>(type: "double precision", nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RefreshAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GooglePlaceLocations", x => new { x.OwnerId, x.PlaceId });
                });

            migrationBuilder.CreateIndex(
                name: "IX_GooglePlaceLocations_ExpiresAt",
                table: "GooglePlaceLocations",
                column: "ExpiresAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GooglePlaceLocations");
        }
    }
}
