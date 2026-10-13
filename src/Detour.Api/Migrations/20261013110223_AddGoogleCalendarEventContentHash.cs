using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Detour.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGoogleCalendarEventContentHash : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContentHash",
                table: "GoogleCalendarManagedEvents",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContentHash",
                table: "GoogleCalendarManagedEvents");
        }
    }
}
