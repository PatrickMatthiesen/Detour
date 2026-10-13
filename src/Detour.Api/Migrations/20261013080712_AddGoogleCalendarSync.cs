using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Detour.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGoogleCalendarSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GoogleCalendarConnections",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    GoogleSubject = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EncryptedRefreshToken = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: false),
                    GrantedScopes = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    CalendarId = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    CalendarCreationAttempted = table.Column<bool>(type: "boolean", nullable: false),
                    LastSyncedVersion = table.Column<long>(type: "bigint", nullable: true),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SyncRequestedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    NextAttemptAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailureCount = table.Column<int>(type: "integer", nullable: false),
                    ReauthorizationRequired = table.Column<bool>(type: "boolean", nullable: false),
                    Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Revision = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleCalendarConnections", x => x.OwnerId);
                });

            migrationBuilder.CreateTable(
                name: "GoogleCalendarManagedEvents",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    LocalKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    GoogleEventId = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleCalendarManagedEvents", x => new { x.OwnerId, x.LocalKey });
                });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleCalendarConnections_NextAttemptAt",
                table: "GoogleCalendarConnections",
                column: "NextAttemptAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoogleCalendarConnections");

            migrationBuilder.DropTable(
                name: "GoogleCalendarManagedEvents");
        }
    }
}
