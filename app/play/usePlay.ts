"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dashboard } from "../../lib/play/dashboard";
import type { PlayVenue } from "../../lib/play/types";
import { createBoardCache } from "./board-cache";
import { useLocale, useT } from "../components/I18nProvider";

const BOARD = "/api/play";
const RESULTS = "/api/play/results";

const boards = createBoardCache();
const boardKey = (viewer: string | null | undefined, locale: string, city: string | null, date: string | null, session?: string | null) => JSON.stringify([viewer ?? null, locale, city, date, session ?? null]);
async function readBoard(params: URLSearchParams): Promise<Dashboard> {
  const response = await fetch(`${BOARD}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const body = await response.json();
  if (!response.ok || !body.ready) throw new Error(body.error ?? "約戰暫時未能使用，請稍後再試。");
  return body as Dashboard;
}

export type ActionResult = { ok: boolean; id?: string; duplicates?: PlayVenue[]; error?: string };

/** The board for one city and day, refreshed on focus and every minute while visible. Writes go
    through `act`; each one refreshes the board and then tells the parent (for the tab badge). */
export function usePlayBoard(onActivity?: () => void, focusSessionId?: string | null, viewerId?: string | null) {
  const t = useT();
  const locale = useLocale();
  const key = boardKey(viewerId, locale, null, null, focusSessionId);
  const [city, setCity] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(() => boards.peek(key));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !boards.peek(key));
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);

  const refresh = useCallback(async (force = true) => {
    const seq = ++sequence.current;
    try {
      const params = new URLSearchParams();
      if (city) params.set("city", city);
      if (date) params.set("date", date);
      if (focusSessionId) params.set("session", focusSessionId);
      const board = await boards.load(boardKey(viewerId, locale, city, date, focusSessionId), () => readBoard(params), force);
      if (seq !== sequence.current || !mounted.current) return;
      setData(board);
      setError("");
    } catch (e) {
      if (seq === sequence.current && mounted.current) setError(e instanceof Error ? e.message : t("未能載入約戰。"));
    } finally {
      if (seq === sequence.current && mounted.current) setLoading(false);
    }
  }, [city, date, focusSessionId, viewerId, locale, t]);

  useEffect(() => {
    mounted.current = true;
    const first = setTimeout(() => void refresh(false), 0);
    const onFocus = () => void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", onFocus);
    const counter = sequence;
    return () => { mounted.current = false; counter.current++; clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const post = useCallback(async (url: string, body: Record<string, unknown>): Promise<ActionResult & Record<string, unknown>> => {
    if (pending.current) return { ok: false, error: t("正在處理上一個操作，請稍候。") };
    pending.current = true;
    setBusy(true);
    sequence.current++;
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: json.error ?? t("約戰暫時未能更新，請重新載入後再試。") };
      boards.clear();
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

  /** Pick a city: show its cached board straight away (if any) while a fresh one loads. */
  const pickCity = useCallback((next: string) => {
    setCity(next);
    setDate(null);
    const hit = boards.peek(boardKey(viewerId, locale, next, null, focusSessionId));
    if (hit) setData(hit);
  }, [viewerId, locale, focusSessionId]);
  /** Pick a day: highlight it at once and show its cached board if we have one. */
  const pickDate = useCallback((next: string) => {
    setDate(next);
    const hit = boards.peek(boardKey(viewerId, locale, city, next, focusSessionId));
    if (hit) setData(hit);
  }, [city, viewerId, locale, focusSessionId]);
  const switching = !!data && ((city != null && data.city !== city) || (date != null && data.date !== date));

  return { data, error, loading, busy, city, pickCity, pickDate, switching, setCity, date, setDate, refresh, act, results };
}

/** A cheap count for the tab badge: results to record and invitations waiting. Reads the same board. */
export function usePlayBadge(viewerId: string | null | undefined) {
  const locale = useLocale();
  const enabled = Boolean(viewerId);
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!enabled) { setCount(0); return; }
    try {
      const body = await boards.load(boardKey(viewerId, locale, null, null), () => readBoard(new URLSearchParams()));
      if (!Array.isArray(body.queue)) return;
      setCount((body.queue as { kind: string }[]).filter((q) => q.kind === "record" || q.kind === "invite").length);
    } catch { /* the badge is best effort */ }
  }, [enabled, viewerId, locale]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(first); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  return { count, refresh };
}
