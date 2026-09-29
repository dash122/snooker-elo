import { PREFERENCE_COOKIE_MAX_AGE } from "./locales.ts";

/** Browser-only. A preference cookie is not a secret and the server needs it on the very next request,
 *  so it is written from the client and followed by `router.refresh()`. */
export function writePreferenceCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
