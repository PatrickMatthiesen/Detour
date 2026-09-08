import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiTarget =
  process.env.API_HTTP ||
  process.env.services__api__http__0 ||
  process.env.TRIP_ADVISOR_API_URL;
const apiProxy = apiTarget
  ? {
      target: apiTarget,
      // Keep the browser's Host header. The API's local-development owner
      // fallback deliberately requires a loopback Host, so a remote browser
      // must never be made to look local by the development proxy.
      changeOrigin: false,
      ws: true,
    }
  : undefined;

const apiPaths = [
  "/api",
  "/auth",
  "/connect",
  "/.well-known",
  "/signin-google",
  "/mcp",
];
const proxy = apiProxy
  ? Object.fromEntries(apiPaths.map((path) => [path, apiProxy]))
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy,
  },
  build: { outDir: "dist" },
});
