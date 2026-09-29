"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE_COOKIE, isTimeZone } from "../../lib/i18n/locales";
import { writePreferenceCookie } from "../../lib/i18n/cookies";
import { useFormatContext } from "./I18nProvider";

/** Reports the browser's IANA zone to the server so server-rendered times follow the viewer rather
 *  than the club. Writes the cookie only when it differs from what the server already used, then
 *  refreshes once — a member whose zone is unchanged never triggers a refresh. */
export function TimeZoneSync() {
  const { timeZone } = useFormatContext();
  const router = useRouter();
  useEffect(() => {
    let detected: string | undefined;
    try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return; }
    if (!isTimeZone(detected) || detected === timeZone) return;
    writePreferenceCookie(TIMEZONE_COOKIE, detected);
    router.refresh();
  }, [timeZone, router]);
  return null;
}
