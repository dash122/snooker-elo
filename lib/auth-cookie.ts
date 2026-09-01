/**
 * Local vinext development runs on plain HTTP. Keep session cookies Secure in
 * production, but omit that attribute locally so browsers can send them back
 * to http://localhost.
 */
export function secureCookieAttribute() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}
