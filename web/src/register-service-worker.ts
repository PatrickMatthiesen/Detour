/// <reference types="vite/client" />

export type ServiceWorkerStatus = "ready" | "error";

/** Register the app shell worker in production and report its install state. */
export async function registerServiceWorker(
  onStatus?: (status: ServiceWorkerStatus, error?: unknown) => void,
): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing?.active?.state === "activated") onStatus?.("ready");

    let registration: ServiceWorkerRegistration;
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (error) {
      if (existing?.active?.state === "activated") return existing;
      throw error;
    }
    if (registration.active?.state === "activated") onStatus?.("ready");

    registration.installing?.addEventListener("statechange", (event) => {
      if ((event.target as ServiceWorker).state === "redundant") {
        onStatus?.("error", new Error("Service worker installation failed."));
      }
    });

    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (worker && registration.active?.state !== "activated") {
      const reportState = () => {
        if (worker.state === "activated") onStatus?.("ready");
        else if (worker.state === "redundant") onStatus?.("error", new Error("Service worker installation failed."));
      };
      reportState();
      worker.addEventListener("statechange", reportState);
    }
    return registration;
  } catch (error) {
    onStatus?.("error", error);
    return null;
  }
}
