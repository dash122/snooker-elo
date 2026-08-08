import { headers } from "next/headers";

/** The absolute origin this request arrived on.
 *
 *  Share links and Open Graph tags must be absolute — a relative URL in a WhatsApp message is not a
 *  link at all — and the origin differs between the preview deployment and production, so it is
 *  read from the request rather than hard-coded. An explicit `NEXT_PUBLIC_SITE_URL` wins where one
 *  is set, because a deployment behind a proxy knows its public name better than its headers do. */
export async function shareOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const protocol = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || (host ? `${protocol}://${host}` : "");
}
