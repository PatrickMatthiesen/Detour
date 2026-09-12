import { DetourIcon } from "./DetourIcon";
import "./login.css";

export function LoginScreen({ mode, googleConfigured = true, expired = false, onRetry }: {
  mode: "login" | "loading" | "error";
  googleConfigured?: boolean;
  expired?: boolean;
  onRetry?: () => void;
}) {
  const params = new URLSearchParams(window.location.search);
  const failure = params.get("login");
  const requestedReturn = params.get("returnUrl");
  params.delete("login");
  params.delete("returnUrl");
  const search = params.toString();
  const returnUrl = requestedReturn || `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const message = failure === "denied"
    ? "This Google account doesn’t have access. Try the account you use for Detour."
    : failure === "failed" ? "Sign-in wasn’t completed. Please try again."
    : expired ? "Your session has ended. Sign in again to continue." : "";
  return <main className="login-page">
    <a className="login-brand" href="/" aria-label="Detour home"><DetourIcon size={36}/>Detour</a>
    <div className="login-layout">
      <section className="login-welcome">
        <h1>A little room<br/>for a detour.</h1>
        <p>Your places, plans and everything<br className="login-linebreak"/> to get you ready for the trip.</p>
        <svg className="login-route" viewBox="0 0 460 180" fill="none" aria-hidden="true">
          <path d="M20 134C92 134 73 40 154 40S213 148 292 148 352 65 435 65" stroke="#a8bdb1" strokeWidth="3" strokeDasharray="6 7"/>
          <circle cx="20" cy="134" r="9" fill="#b94b39"/><circle cx="154" cy="40" r="11" fill="#e8bc67"/>
          <circle cx="292" cy="148" r="9" fill="#aaa0cc"/><circle cx="435" cy="65" r="13" fill="#507970"/>
        </svg>
      </section>
      <section className="login-panel" aria-labelledby="login-heading">
        <DetourIcon className="login-symbol" size={48}/>
        <h2 id="login-heading">Welcome to Detour</h2>
        {mode === "loading" ? <p role="status">Getting things ready…</p>
          : mode === "error" ? <><p role="alert">We couldn’t connect to Detour.</p><button className="login-google" onClick={onRetry}>Try again</button></>
          : <><p>Sign in to open your trip.</p>
            {message && <p className="login-notice" role="alert">{message}</p>}
            {googleConfigured ? <a className="login-google" href={`/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.96Z"/></svg>
              Continue with Google
            </a> : <p className="login-notice">Sign-in isn’t available yet. Please contact the person hosting Detour.</p>}
            <small>Use an account with access to this Detour.</small>
          </>}
      </section>
    </div>
  </main>;
}
