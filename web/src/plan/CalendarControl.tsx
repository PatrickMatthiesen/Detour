import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Link2, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { connectCalendar, disconnectCalendar, getCalendarStatus, syncCalendar, type CalendarStatus } from "../api";
import { MutationButton } from "../trip-editing";

const initial: CalendarStatus = {
  configured: false,
  connected: false,
  calendarId: null,
  lastSyncedVersion: null,
  lastSyncedAt: null,
  error: null,
};

export default function CalendarControl() {
  const [status, setStatus] = useState<CalendarStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [transportError, setTransportError] = useState("");
  const [actionMessage, setActionMessage] = useState(() => new URLSearchParams(window.location.search).get("calendar") === "failed"
    ? "Google Calendar connection did not finish. Try connecting again."
    : "");

  const refresh = useCallback(async () => {
    try {
      setStatus(await getCalendarStatus());
      setTransportError("");
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : "Could not load calendar status.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!status.configured || (!status.connected && !status.error && !status.syncPending)) return;
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh, status.configured, status.connected, status.error, status.syncPending]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const run = async (action: () => Promise<CalendarStatus>) => {
    setBusy(true);
    setActionMessage("");
    setTransportError("");
    try {
      setStatus(await action());
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Calendar request failed.");
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setActionMessage("");
    setTransportError("");
    try {
      const result = await connectCalendar();
      window.location.assign(result.url);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not start Google Calendar connection.");
      setBusy(false);
    }
  };

  const retrySync = async () => {
    setBusy(true);
    setActionMessage("");
    setTransportError("");
    try {
      setStatus(await syncCalendar());
      await new Promise(resolve => window.setTimeout(resolve, 15000));
      setStatus(await getCalendarStatus());
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Calendar sync failed.");
      try { setStatus(await getCalendarStatus()); } catch { /* Keep the action error visible. */ }
    } finally {
      setBusy(false);
    }
  };

  const visibleErrors = [actionMessage, status.error, transportError].filter(Boolean);

  return <section className="plan-google-calendar" aria-label="Google Calendar sync">
    <div className="plan-google-calendar-copy">
      <span className="plan-google-calendar-icon" aria-hidden="true"><CalendarDays size={16}/></span>
      <span><strong>Google trip calendar</strong><small>{status.connected ? "Connected · Detour sends trip changes one way" : status.configured ? "Connect a separate calendar for this trip" : "Google Calendar connection is unavailable"}</small></span>
    </div>
    <div className="plan-google-calendar-actions">
      {status.connected ? <>
        <MutationButton type="button" onClick={() => void retrySync()} disabled={busy}><RefreshCw size={14}/> Retry sync</MutationButton>
      </> : status.syncPending ? <MutationButton type="button" disabled><LoaderCircle size={14}/> Sync pending</MutationButton>
        : <MutationButton type="button" onClick={() => void connect()} disabled={busy || !status.configured}><Link2 size={14}/> Connect Google</MutationButton>}
      {!status.connected && status.configured && status.error && <MutationButton type="button" onClick={() => void retrySync()} disabled={busy}><RefreshCw size={14}/> Retry sync</MutationButton>}
      {(status.connected || status.calendarId || status.error || status.syncPending) && <MutationButton type="button" onClick={() => void run(disconnectCalendar)} disabled={busy}><Unplug size={14}/> Disconnect</MutationButton>}
      {busy && <LoaderCircle className="plan-calendar-spinner" size={14} aria-label="Working"/>}
    </div>
    {!!visibleErrors.length && <p className="plan-google-calendar-error" role="status">{visibleErrors.join(" · ")} {status.connected && <MutationButton type="button" onClick={() => void connect()} disabled={busy}>Reconnect</MutationButton>}</p>}
    {!status.connected && status.syncPending && <p className="plan-google-calendar-sync" role="status">Calendar setup retry is queued.</p>}
    {status.connected && status.lastSyncedAt && <p className="plan-google-calendar-sync">Last synced {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastSyncedAt))}</p>}
  </section>;
}
