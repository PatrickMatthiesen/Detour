import { describe, expect, it, vi } from "vitest";
import { createOfflineServiceWorker } from "./offline-service-worker";

function makeWorker(fetchImpl: typeof fetch = vi.fn()) {
  const handlers: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, { response: Response; origin: string | null }>>();
  const self = {
    location: { origin: "https://detour.test" },
    clients: { claim: vi.fn(async () => {}) },
    addEventListener: (type: string, handler: (event: any) => void) => { handlers[type] = handler; },
  };
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        addAll: async (paths: string[]) => {
          for (const path of paths) {
            const request = new Request(new URL(path, self.location.origin));
            const headers = new Headers();
            if (path.endsWith(".js") || path.endsWith(".css")) headers.set("Vary", "Origin");
            store.set(request.url, { response: new Response("shell", { headers }), origin: request.headers.get("Origin") });
          }
        },
        put: async (request: Request, response: Response) => {
          store.set(request.url, { response, origin: request.headers.get("Origin") });
        },
        match: async (request: Request | string, options?: { ignoreVary?: boolean }) => {
          if (typeof request === "string") return store.get(new URL(request, self.location.origin).href)?.response;
          const entry = store.get(request.url);
          if (!entry) return undefined;
          const vary = entry.response.headers.get("Vary")?.toLowerCase().split(/,\s*/);
          if (!options?.ignoreVary && vary?.includes("origin") && entry.origin !== request.headers.get("Origin")) return undefined;
          return entry.response;
        },
      };
    }),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: Request) => {
      for (const store of stores.values()) if (store.has(request.url)) return store.get(request.url)?.response;
      return undefined;
    },
  };
  const source = createOfflineServiceWorker(["/assets/app-hash.js"], "test");
  new Function("self", "caches", "fetch", "URL", "Request", "Response", source)(self, caches, fetchImpl, URL, Request, Response);

  const dispatch = async (type: string, event: any) => {
    let pending: Promise<unknown> | undefined;
    let response: Promise<unknown> | undefined;
    event.waitUntil = (promise: Promise<unknown>) => { pending = promise; };
    event.respondWith = (promise: Promise<unknown>) => { response = Promise.resolve(promise); };
    handlers[type](event);
    await pending;
    return response ? await response : undefined;
  };
  return { caches, dispatch, self, stores };
}

describe("offline app shell worker", () => {
  it("pre-caches the shell and falls back to its HTML for supported routes offline", async () => {
    const fetchOffline = vi.fn(async () => { throw new TypeError("offline"); });
    const worker = makeWorker(fetchOffline);
    await worker.dispatch("install", {});
    const cache = worker.stores.get("detour-app-shell-test")!;
    expect(cache.has("https://detour.test/assets/app-hash.js")).toBe(true);
    expect(cache.has("https://detour.test/index.html")).toBe(true);

    const response = await worker.dispatch("fetch", {
      request: { url: "https://detour.test/plan", method: "GET", mode: "navigate" },
    });
    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).text()).toBe("shell");
    expect(fetchOffline).toHaveBeenCalledTimes(1);
  });

  it("uses the network response and its security headers for supported routes online", async () => {
    let online = true;
    const fetchOnline = vi.fn(async () => {
      if (!online) throw new TypeError("offline");
      return new Response("fresh shell", {
        headers: { "Content-Security-Policy": "default-src 'self'" },
      });
    });
    const worker = makeWorker(fetchOnline);
    await worker.dispatch("install", {});

    const response = await worker.dispatch("fetch", {
      request: { url: "https://detour.test/plan", method: "GET", mode: "navigate" },
    });

    expect(fetchOnline).toHaveBeenCalledTimes(1);
    expect((response as Response).headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(await (response as Response).text()).toBe("fresh shell");
    expect(await worker.stores.get("detour-app-shell-test")!.get("https://detour.test/index.html")?.response.clone().text()).toBe("shell");

    online = false;
    const offlineResponse = await worker.dispatch("fetch", {
      request: { url: "https://detour.test/plan", method: "GET", mode: "navigate" },
    });
    expect(await (offlineResponse as Response).text()).toBe("shell");
  });

  it("serves pre-cached module assets when the browser adds Origin to a Vary: Origin request", async () => {
    const networkFetch = vi.fn(async () => new Response("network"));
    const worker = makeWorker(networkFetch);
    await worker.dispatch("install", {});

    const response = await worker.dispatch("fetch", {
      request: {
        url: "https://detour.test/assets/app-hash.js",
        method: "GET",
        mode: "cors",
        destination: "script",
        headers: new Headers({ Origin: "https://detour.test" }),
      },
    });

    expect(await (response as Response).text()).toBe("shell");
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("does not intercept API or sign-in responses", async () => {
    const fetchOnline = vi.fn(async () => new Response("private", { status: 200 }));
    const worker = makeWorker(fetchOnline);
    for (const path of ["/api/trip", "/auth/login"]) {
      const response = await worker.dispatch("fetch", {
        request: { url: `https://detour.test${path}`, method: "GET", mode: "cors" },
      });
      expect(response).toBeUndefined();
    }
  });
});
