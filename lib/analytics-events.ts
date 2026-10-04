/* Client-side analytics, batched.

   Events that the server already knows about (a join, a leave, a recorded result) are written by the
   API routes after the write succeeds, not from here: a fact should not depend on a beacon surviving
   the page. This module is only for the signals that exist nowhere but the client, such as viewing a
   screen. It writes to the club's own database through /api/analytics: no vendor, no third-party
   script, and nothing leaves the deployment.

   Batched and flushed on a timer or when the page goes away. Everything is best effort: analytics
   must never be visible to a member, as latency or as an error. */

export type AnalyticsEventName =
  /* 球隊 — viewing a squad's table. Joins, leaves and settings are recorded server-side. */
  | "squad_view"
  /* 約戰 — arriving on the board. Everything after that is recorded server-side by /api/play. */
  | "play_board_view";

type QueuedEvent = { event: AnalyticsEventName; props?: Record<string, unknown>; at: string };

const FLUSH_MS = 5000, MAX_BATCH = 20;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(useBeacon = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length || typeof window === "undefined") return;
  const batch = queue;
  queue = [];
  const body = JSON.stringify({ events: batch });
  try {
    /* On pagehide a normal fetch is likely to be killed mid-flight; sendBeacon is the only transport
       the browser promises to finish. */
    if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" })); return; }
    void fetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* analytics must never surface to a member */ }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
}

export function trackEvent(event: AnalyticsEventName, props?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  queue.push({ event, props, at: new Date().toISOString() });
  if (queue.length >= MAX_BATCH) return flush();
  timer ??= setTimeout(() => flush(), FLUSH_MS);
}
