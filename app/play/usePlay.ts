"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dashboard } from "../../lib/play/dashboard";
import type { PlayVenue } from "../../lib/play/types";
import { useT } from "../components/I18nProvider";

const BOARD = "/api/play";
const RESULTS = "/api/play/results";

export type ActionResult = { ok: boolean; id?: string; duplicates?: PlayVenue[]; error?: string };

/** The board for one city and day, refreshed on focus and every minute while visible. Writes go
    through `act`; each one refreshes the board and then tells the parent (for the tab badge). */
export function usePlayBoard(onActivity?: () => void, focusSessionId?: string | null) {
  const t = useT();
  const [city, setCity] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const params = new URLSearchParams();
      if (city) params.set("city", city);
      if (date) params.set("date", date);
      if (focusSessionId) params.set("session", focusSessionId);
      const response = await fetch(`${BOARD}?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("未能載入約戰。"));
      if (seq !== sequence.current || !mounted.current) return;
      if (!body.ready) throw new Error(t("約戰暫時未能使用，請稍後再試。"));
      setData(body as Dashboard);
      setError("");
    } catch (e) {
      if (seq === sequence.current && mounted.current) setError(e instanceof Error ? e.message : t("未能載入約戰。"));
    } finally {
      if (seq === sequence.current && mounted.current) setLoading(false);
    }
  }, [city, date, focusSessionId, t]);

  useEffect(() => {
    mounted.current = true;
    const first = setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", onFocus);
    const counter = sequence;
    return () => { mounted.current = false; counter.current++; clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const post = useCallback(async (url: string, body: Record<string, unknown>): Promise<ActionResult & Record<string, unknown>> => {
    if (pending.current) return { ok: false, error: t("處理緊上一個操作，請稍等。") };
    pending.current = true;
    setBusy(true);
    sequence.current++;
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: json.error ?? t("約戰暫時未能更新，請重新載入後再試。") };
      await refresh();
      onActivity?.();
      return { ok: true, ...json };
    } catch {
      return { ok: false, error: t("網絡有問題，請稍後再試。") };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [t, refresh, onActivity]);

  const act = useCallback((action: string, values: Record<string, unknown> = {}) => post(BOARD, { action, ...values }), [post]);
  const results = useCallback((values: Record<string, unknown>) => post(RESULTS, values), [post]);

  return { data, error, loading, busy, city, setCity, date, setDate, refresh, act, results };
}

/** A cheap count for the tab badge: results to record and invitations waiting. Reads the same board. */
export function usePlayBadge(enabled: boolean) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!enabled) { setCount(0); return; }
    try {
      const response = await fetch(BOARD, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      if (!body.ready || !Array.isArray(body.queue)) return;
      setCount((body.queue as { kind: string }[]).filter((q) => q.kind === "record" || q.kind === "invite").length);
    } catch { /* the badge is best effort */ }
  }, [enabled]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(first); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  return { count, refresh };
}
