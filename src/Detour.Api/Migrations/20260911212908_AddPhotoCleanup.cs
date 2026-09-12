using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Detour.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPhotoCleanup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PhotoObjectDeletions",
                columns: table => new
                {
                    ObjectKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NotBefore = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhotoObjectDeletions", x => x.ObjectKey);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PhotoObjectDeletions");
        }
    }
}
