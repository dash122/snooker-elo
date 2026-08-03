/* Service worker for match notifications.
 *
 * Deliberately minimal: no offline caching, no fetch handler. The club's data is live scores and live
 * availability, and a stale cached leaderboard is worse than a spinner. This worker exists only so
 * the browser has somewhere to deliver a push while the app is closed — which is the entire point of
 * the matchmaking notification work. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "SCAA Snooker ELO", body: event.data.text() }; }
  const url = payload.url || "/?tab=availability";
  event.waitUntil(self.registration.showNotification(payload.title || "SCAA Snooker ELO", {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Same tag replaces rather than stacks, so three nudges about one opponent stay one line.
    tag: payload.tag || "snooker",
    renotify: true,
    data: { url },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/?tab=availability";
  // Focus an already-open tab instead of piling up new ones; only open a window if nothing is running.
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      if (client.url.includes(self.registration.scope) && "focus" in client) {
        client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
