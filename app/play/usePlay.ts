"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dashboard } from "../../lib/play/dashboard";
import type { PlayVenue } from "../../lib/play/types";
import { useT } from "../components/I18nProvider";

const BOARD = "/api/play";
const RESULTS = "/api/play/results";

/** The last board seen in this page load, so switching back to the tab paints at once while a fresh one loads. */
const boards = new Map<string, Dashboard>();
const boardKey = (city: string | null, date: string | null) => `${city ?? ""}|${date ?? ""}`;
const latest = () => Array.from(boards.values()).at(-1) ?? null;

export type ActionResult = { ok: boolean; id?: string; duplicates?: PlayVenue[]; error?: string };

/** The board for one city and day, refreshed on focus and every minute while visible. Writes go
    through `act`; each one refreshes the board and then tells the parent (for the tab badge). */
export function usePlayBoard(onActivity?: () => void, focusSessionId?: string | null) {
  const t = useT();
  const [city, setCity] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(() => latest());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !latest());
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const warming = useRef(new Set<string>());

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
      const board = body as Dashboard;
      boards.set(boardKey(city, date), board);
      boards.set(boardKey(board.city, board.date), board);
      setData(board);
      // Warm the other days of this city too, so tapping a day is instant.
      for (const d of board.dates) {
        const k = boardKey(board.city, d.date);
        if (boards.has(k) || warming.current.has(k)) continue;
        warming.current.add(k);
        void fetch(`${BOARD}?${new URLSearchParams({ city: board.city, date: d.date })}`, { cache: "no-store" }).then((r) => r.json()).then((b) => { if (b.ready) boards.set(k, b as Dashboard); }).catch(() => warming.current.delete(k));
      }
      // Warm the other cities so switching to them is instant.
      for (const c of board.cities) {
        if (boards.has(boardKey(c.id, null)) || warming.current.has(c.id)) continue;
        warming.current.add(c.id);
        void fetch(`${BOARD}?${new URLSearchParams({ city: c.id })}`, { cache: "no-store" }).then((r) => r.json()).then((b) => { if (b.ready) boards.set(boardKey(c.id, null), b as Dashboard); }).catch(() => warming.current.delete(c.id));
      }
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
    if (pending.current) return { ok: false, error: t("正在處理上一個操作，請稍候。") };
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

  /** Pick a city: show its cached board straight away (if any) while a fresh one loads. */
  const pickCity = useCallback((next: string) => {
    setCity(next);
    setDate(null);
    const hit = boards.get(boardKey(next, null));
    if (hit) setData(hit);
  }, []);
  /** Pick a day: highlight it at once and show its cached board if we have one. */
  const pickDate = useCallback((next: string) => {
    setDate(next);
    const hit = boards.get(boardKey(city ?? data?.city ?? null, next));
    if (hit) setData(hit);
  }, [city, data?.city]);
  const switching = !!data && ((city != null && data.city !== city) || (date != null && data.date !== date));

  return { data, error, loading, busy, city, pickCity, pickDate, switching, setCity, date, setDate, refresh, act, results };
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
