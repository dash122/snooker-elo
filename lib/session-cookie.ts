/* The session cookie was renamed scaa_session -> elo_session. Until old cookies age out, a request
   may carry either, so reads prefer the new name and fall back to the old one; logout clears both. */
export const SESSION_COOKIE = "elo_session";
export const LEGACY_SESSION_COOKIE = "scaa_session";

export function parseCookie(cookie: string | null, name: string): string | null {
  const item = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export function readSessionToken(cookie: string | null): string | null {
  return parseCookie(cookie, SESSION_COOKIE) || parseCookie(cookie, LEGACY_SESSION_COOKIE);
}
