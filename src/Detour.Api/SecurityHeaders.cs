namespace Detour.Api;

public static class SecurityHeaders
{
    // MapLibre uses blob workers and inline styles; fonts and map assets are
    // the only external resources loaded by the production frontend.
    public const string ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                headers["X-Content-Type-Options"] = "nosniff";
                headers["X-Frame-Options"] = "DENY";
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
                // Leave local Vite HMR unaffected; enforce the production policy
                // on API errors and static files as well as the SPA document.
                if (!context.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment())
                {
                    headers.ContentSecurityPolicy = ContentSecurityPolicy;
                    if (context.Request.IsHttps)
                        headers.StrictTransportSecurity = "max-age=31536000";
                }
                return Task.CompletedTask;
            });
            await next(context);
        });
    }
}
