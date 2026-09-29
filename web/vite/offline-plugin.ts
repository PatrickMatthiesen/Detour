import { createHash } from "node:crypto";
import { createOfflineServiceWorker } from "../src/offline-service-worker";
import type { OutputBundle } from "rollup";
import type { Plugin } from "vite";

function outputText(source: string | Uint8Array): string {
  return typeof source === "string" ? source : new TextDecoder().decode(source);
}

function buildFingerprint(bundle: OutputBundle, workerTemplate: string): string {
  const hash = createHash("sha256");
  const relevant = Object.values(bundle)
    .filter((item) => item.type === "chunk" || item.fileName === "index.html")
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  for (const item of relevant) {
    hash.update(item.fileName).update("\0");
    hash.update(item.type === "chunk" ? item.code : outputText(item.source)).update("\0");
  }
  hash.update("worker\0").update(workerTemplate);
  return hash.digest("hex").slice(0, 16);
}

export function offlineAppShellPlugin(): Plugin {
  return {
    name: "detour-offline-app-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const assetPaths = Object.values(bundle)
        .filter((item) => item.fileName !== "sw.js" && !item.fileName.endsWith(".map"))
        .map((item) => `/${item.fileName}`);
      const workerTemplate = createOfflineServiceWorker([], "");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: createOfflineServiceWorker(assetPaths, buildFingerprint(bundle, workerTemplate)),
      });
    },
  };
}
