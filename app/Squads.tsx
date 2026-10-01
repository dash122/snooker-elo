"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MySquad, SquadDetail, SquadSummary } from "../db/squads.pg";
import { SQUAD_NAME_MAX, type SquadRole, type SquadVisibility } from "../lib/squads";
import { useT } from "./components/I18nProvider";
import { trackAvailabilityEvent } from "../lib/availability-analytics";
import { Button, Chip, EmptyState, FormField, IconButton, InlineNotice, SegmentedControl, Skeleton } from "./components/ui/Primitives";
import { Sheet } from "./components/ui/Overlay";
import { PlayerBadge, PlayerCombobox } from "./UiBits";

/* 球隊 — member-formed groups whose leaderboard is the club ELO filtered to the squad. Everything
   here is presentation; who may do what is decided server-side in db/squads.pg.ts.

   Built for someone in many squads: the leaderboard carries one chip naming the current view, and
   everything else (switching, pinning, browsing, creating, managing) lives in sheets opened from it,
   so the ranking panel never grows a tab per squad. */

type Person = { id: string; name: string; short?: string | null; colour?: string | null; avatar?: string | null };
export type SquadSheet = "picker" | "manage" | "browse" | "create" | null;

const PIN_KEY = "scaa:squads:pinned", RECENT_KEY = "scaa:squads:recent", PENDING_JOIN_KEY = "scaa:squads:pending-join";
const SEARCH_THRESHOLD = 8;
type PublicSquad = SquadSummary & { playedWith: number };

/* Pins and recents are a per-viewer convenience, so browser storage is right for them — and every
   access is guarded, because storage can be absent or throw (private windows, blocked site data). */
function readList(key: string): string[] {
  try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string") : []; }
  catch { return []; }
}
function writeList(key: string, list: string[]) { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* convenience only */ } }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init?.body ? { ...init, headers: { "content-type": "application/json", ...init.headers } } : init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || String(response.status));
  return body;
}

export function inviteUrl(code: string) {
  return `${window.location.origin}/?join=${encodeURIComponent(code)}`;
}

/** The viewer's squads, loaded once they are a signed-in member with a linked player. */
export function useSquads(enabled: boolean) {
  const [squads, setSquads] = useState<MySquad[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => call<{ squads: MySquad[] }>("/api/squads")
    .then(body => setSquads(body.squads))
    /* keep what is on screen; the club leaderboard never depends on this */
    .catch(() => {})
    .finally(() => setLoaded(true)), []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  const refresh = useCallback(async () => { if (enabled) await load(); }, [enabled, load]);
  return { squads, loaded, refresh };
}

/** The squad named by `?squad=` when the viewer isn't a member of it: public squads are visible to
    everyone, signed in or not. Private ones 404 and read as no selection. */
export function usePublicSquad(id: string | null, mine: MySquad[], mineLoaded: boolean) {
  const [found, setFound] = useState<SquadDetail | null>(null);
  const isMine = Boolean(id && mine.some(squad => squad.id === id));
  useEffect(() => {
    if (!id || isMine || !mineLoaded) return;
    let live = true;
    call<{ squad: SquadDetail }>(`/api/squads/${encodeURIComponent(id)}`)
      .then(body => live && setFound(body.squad)).catch(() => live && setFound(null));
    return () => { live = false; };
  }, [id, isMine, mineLoaded]);
  return found && found.id === id && !isMine ? { ...found, addedBy: null } as MySquad : null;
}

/* `?squad=` keeps the selected view shareable and across reloads; `?join=` carries an invite.
   Both are read straight from the URL (null during server render), so there is no copy in React
   state to fall out of step with it. */
const URL_EVENT = "scaa:squad-url";
function subscribeUrl(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(URL_EVENT, onChange);
  return () => { window.removeEventListener("popstate", onChange); window.removeEventListener(URL_EVENT, onChange); };
}
export function useUrlParam(name: "squad" | "join") {
  return useSyncExternalStore(subscribeUrl, () => new URLSearchParams(window.location.search).get(name), () => null);
}
export function writeUrlParam(name: "squad" | "join", value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(URL_EVENT));
}
/** A guest who opened an invite and then signed in comes back to `/` without it; put it back. */
export function useResumePendingJoin(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(PENDING_JOIN_KEY); sessionStorage.removeItem(PENDING_JOIN_KEY); } catch { /* nothing to resume */ }
    if (saved) writeUrlParam("join", saved);
  }, [signedIn]);
}

/** Records each arrival on a squad's table (not re-renders of the same one). */
export function useSquadViewTracking(squad: MySquad | null) {
  const id = squad?.id, size = squad?.memberCount;
  useEffect(() => {
    if (!id) return;
    writeList(RECENT_KEY, [id, ...readList(RECENT_KEY).filter(item => item !== id)].slice(0, 20));
    trackAvailabilityEvent("squad_view", { squadId: id, memberCount: size });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The squad to land on when someone flips the scope to 球隊: last used, then pinned, then any of theirs. */
export function defaultSquadId(squads: MySquad[]): string | null {
  const mine = new Set(squads.map(squad => squad.id));
  return [...readList(RECENT_KEY), ...readList(PIN_KEY)].find(id => mine.has(id)) ?? squads[0]?.id ?? null;
}

/** The scope control that frames a page as the whole club or one squad. In a squad it also carries the
    squad's identity (who is in it) and its two actions, so a squad reads as a place rather than a filter. */
export function SquadScope({ squad, players, onClub, onSquad, onSwitch, onManage, compact = false }: {
  squad: MySquad | null; players: Person[]; onClub: () => void; onSquad: () => void; onSwitch: () => void; onManage: () => void; compact?: boolean;
}) {
  const t = useT();
  const byId = new Map(players.map(player => [player.id, player]));
  const faces = squad ? squad.members.map(member => byId.get(member.playerId)).filter((person): person is Person => Boolean(person)).slice(0, 5) : [];
  return <div className="squad-scope">
    <SegmentedControl label={t("檢視範圍")} value={squad ? "squad" : "club"} onChange={value => value === "squad" ? onSquad() : onClub()}
      items={[{ value: "club", label: t("全會") }, { value: "squad", label: t("球隊") }]} />
    {squad && <div className={`squad-hub${compact ? " squad-hub--compact" : ""}`}>
      {!compact && <span className="squad-hub-faces" aria-hidden="true">{faces.map(person => <PlayerBadge key={person.id} player={person} />)}</span>}
      <span className="squad-hub-name"><b>{squad.name}</b><small>{t("{count} 位隊員", { count: squad.memberCount })}</small></span>
      <span className="squad-hub-actions">
        <Button variant="secondary" type="button" onClick={onSwitch}>{t("切換球隊")}</Button>
        {squad.role && !compact && <Button variant="secondary" type="button" onClick={onManage}>{squad.role === "host" ? t("管理球隊") : t("球隊資料")}</Button>}
      </span>
    </div>}
  </div>;
}

/** Shown once for each squad someone else added the viewer to: the consent step a direct add skips. */
export function SquadAddedNotices({ squads, players, onView, onLeave, onDismiss }: {
  squads: MySquad[]; players: Person[]; onView: (id: string) => void; onLeave: (id: string) => void; onDismiss: (id: string) => void;
}) {
  const t = useT();
  const added = squads.filter(squad => squad.addedBy);
  if (!added.length) return null;
  const nameOf = (id: string | null) => players.find(player => player.id === id)?.name ?? t("隊長");
  return <div className="squad-added-notices">{added.map(squad =>
    <InlineNotice key={squad.id} title={t("你已被加入「{squad}」", { squad: squad.name })}>
      {t("{host} 將你加入呢個球隊，隊員會喺球隊排名見到你。", { host: nameOf(squad.addedBy) })}
      <span className="squad-added-actions">
        <Button variant="secondary" type="button" onClick={() => onView(squad.id)}>{t("查看")}</Button>
        <Button variant="quiet" type="button" onClick={() => onLeave(squad.id)}>{t("退出")}</Button>
        <Button variant="quiet" type="button" onClick={() => onDismiss(squad.id)}>{t("知道了")}</Button>
      </span>
    </InlineNotice>)}</div>;
}

export function SquadCenter({ sheet, setSheet, squads, loaded, refresh, selectedId, onSelect, players, ownPlayerId, signedIn, notify }: {
  sheet: SquadSheet; setSheet: (sheet: SquadSheet) => void;
  squads: MySquad[]; loaded: boolean; refresh: () => Promise<void>;
  selectedId: string | null; onSelect: (id: string | null) => void;
  players: Person[]; ownPlayerId?: string; signedIn: boolean;
  notify: (text: string) => void;
}) {
  const close = () => setSheet(null);
  const joinCode = useUrlParam("join");
  useResumePendingJoin(signedIn);
  const clearJoinCode = () => writeUrlParam("join", null);
  const selected = squads.find(squad => squad.id === selectedId) ?? null;
  return <>
    {sheet === "picker" && <SquadPicker squads={squads} loaded={loaded} signedIn={signedIn} selectedId={selectedId} onSelect={id => { onSelect(id); close(); }} onBrowse={() => setSheet("browse")} onCreate={() => setSheet("create")} onClose={close} />}
    {sheet === "create" && <CreateSquad onClose={close} onCreated={async id => { await refresh(); onSelect(id); setSheet("manage"); }} />}
    {sheet === "browse" && <BrowseSquads signedIn={signedIn} onView={id => { onSelect(id); close(); }} onClose={close} onJoined={async (id, name) => { await refresh(); onSelect(id); close(); notify(name); }} />}
    {joinCode && <JoinSquad code={joinCode} signedIn={signedIn} onClose={clearJoinCode} onJoined={async (id, name) => { clearJoinCode(); await refresh(); onSelect(id); notify(name); }} />}
    {sheet === "manage" && selected && ownPlayerId && <ManageSquad squad={selected} players={players} ownPlayerId={ownPlayerId} refresh={refresh}
      onGone={async () => { onSelect(null); close(); await refresh(); }} onClose={close} />}
  </>;
}

function SquadPicker({ squads, loaded, signedIn, selectedId, onSelect, onBrowse, onCreate, onClose }: {
  squads: MySquad[]; loaded: boolean; signedIn: boolean; selectedId: string | null; onSelect: (id: string | null) => void; onBrowse: () => void; onCreate: () => void; onClose: () => void;
}) {
  const t = useT();
  // Only ever rendered after a tap, never on the server, so storage can be read on first render.
  const [pinned, setPinned] = useState<string[]>(() => readList(PIN_KEY));
  const [recent] = useState<string[]>(() => readList(RECENT_KEY));
  const [query, setQuery] = useState("");
  const togglePin = (id: string) => setPinned(list => { const next = list.includes(id) ? list.filter(item => item !== id) : [id, ...list]; writeList(PIN_KEY, next); return next; });
  const pick = (id: string | null) => { if (id) writeList(RECENT_KEY, [id, ...recent.filter(item => item !== id)].slice(0, 20)); onSelect(id); };
  /* Pinned first, then most recently viewed, then alphabetical — so the two or three squads someone
     actually switches between stay on top however many they are in. */
  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (id: string) => { const p = pinned.indexOf(id), r = recent.indexOf(id); return p >= 0 ? p : r >= 0 ? 1000 + r : 10000; };
    return squads.filter(squad => !q || squad.name.toLowerCase().includes(q))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }, [squads, pinned, recent, query]);
  return <Sheet open title={t("選擇球隊篩選")} onClose={onClose} className="squad-sheet">
    {squads.length > SEARCH_THRESHOLD && <FormField label={t("搜尋我的球隊")}><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></FormField>}
    <ul className="squad-list" aria-label={t("球隊篩選")}>
      {!query && <li><button type="button" className="squad-option" aria-pressed={!selectedId} onClick={() => pick(null)}>
        <span className="squad-option-main"><b>{t("全會")}</b><small>{t("所有球員")}</small></span>
      </button></li>}
      {!loaded && <li aria-hidden="true"><Skeleton height="3rem" /></li>}
      {ordered.map(squad => <li key={squad.id} className="squad-row">
        <button type="button" className="squad-option" aria-pressed={squad.id === selectedId} onClick={() => pick(squad.id)}>
          <span className="squad-option-main"><b>{squad.name}</b><small>{t("{count} 位隊員", { count: squad.memberCount })}</small></span>
          <SquadBadges squad={squad} />
        </button>
        <IconButton className="squad-pin" type="button" aria-pressed={pinned.includes(squad.id)} label={pinned.includes(squad.id) ? t("取消置頂 {name}", { name: squad.name }) : t("置頂 {name}", { name: squad.name })} onClick={() => togglePin(squad.id)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" /></svg>
        </IconButton>
      </li>)}
      {loaded && query && !ordered.length && <li className="squad-list-empty">{t("沒有符合的球隊")}</li>}
    </ul>
    {signedIn && loaded && !squads.length && <p className="squad-hint">{t("組個球隊，同經常打波嘅朋友睇自己嘅排名。")}</p>}
    <div className="squad-sheet-actions">
      <Button variant="secondary" type="button" onClick={onBrowse}>{t("瀏覽公開球隊")}</Button>
      {signedIn && <Button type="button" onClick={onCreate}>{t("建立球隊")}</Button>}
    </div>
  </Sheet>;
}

function SquadBadges({ squad }: { squad: SquadSummary }) {
  const t = useT();
  return <span className="squad-badges">
    {squad.role === "host" && <Chip tone="accent">{t("隊長")}</Chip>}
    <Chip>{squad.visibility === "public" ? t("公開") : t("私人")}</Chip>
  </span>;
}

function VisibilityControl({ value, onChange }: { value: SquadVisibility; onChange: (value: SquadVisibility) => void }) {
  const t = useT();
  return <div className="squad-visibility">
    <SegmentedControl label={t("公開設定")} value={value} onChange={next => onChange(next as SquadVisibility)}
      items={[{ value: "private", label: t("私人") }, { value: "public", label: t("公開") }]} />
    <small>{value === "public" ? t("任何會員都可以搜尋同一按加入。") : t("只有收到邀請連結或由隊長加入嘅會員先可以加入。")}</small>
  </div>;
}

function CreateSquad({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(""), [visibility, setVisibility] = useState<SquadVisibility>("private");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async () => {
    if (!name.trim()) { setError(t("請輸入球隊名稱。")); return; }
    setBusy(true); setError("");
    try { const { id } = await call<{ id: string }>("/api/squads", { method: "POST", body: JSON.stringify({ name, visibility }) }); await onCreated(id); }
    catch (err) { setError(err instanceof Error ? err.message : t("未能建立球隊。")); setBusy(false); }
  };
  return <Sheet open title={t("建立球隊")} onClose={() => !busy && onClose()} className="squad-sheet">
    <form className="squad-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <FormField label={t("球隊名稱")} error={error}><input value={name} maxLength={SQUAD_NAME_MAX} autoComplete="off" onChange={event => setName(event.target.value)} /></FormField>
      <VisibilityControl value={visibility} onChange={setVisibility} />
      <div className="squad-sheet-actions"><Button type="submit" loading={busy}>{t("建立")}</Button></div>
    </form>
  </Sheet>;
}

function BrowseSquads({ signedIn, onView, onClose, onJoined }: { signedIn: boolean; onView: (id: string) => void; onClose: () => void; onJoined: (id: string, name: string) => Promise<void> }) {
  const t = useT();
  const [query, setQuery] = useState(""), [results, setResults] = useState<PublicSquad[] | null>(null);
  const [joining, setJoining] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      call<{ squads: PublicSquad[] }>(`/api/squads/browse?q=${encodeURIComponent(query.trim())}`)
        .then(body => live && setResults(body.squads))
        .catch(err => live && setError(err instanceof Error ? err.message : t("未能載入球隊。")));
    }, query ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [query, t]);
  const join = async (squad: SquadSummary) => {
    setJoining(squad.id); setError("");
    try { await call("/api/squads/join", { method: "POST", body: JSON.stringify({ squadId: squad.id }) }); await onJoined(squad.id, squad.name); }
    catch (err) { setError(err instanceof Error ? err.message : t("未能加入球隊。")); setJoining(null); }
  };
  return <Sheet open title={t("公開球隊")} onClose={onClose} className="squad-sheet">
    <FormField label={t("搜尋球隊名稱")}><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></FormField>
    {error && <InlineNotice tone="danger" title={t("未能完成")}>{error}</InlineNotice>}
    {results === null ? <Skeleton height="3rem" /> : results.length === 0
      ? <EmptyState title={t("未有符合嘅公開球隊")} description={t("可以自己建立一個，再邀請朋友加入。")} />
      : <ul className="squad-list">{results.map(squad => <li key={squad.id} className="squad-row">
        <span className="squad-option squad-option--static"><span className="squad-option-main"><b>{squad.name}</b><small>{squad.playedWith ? t("{count} 位隊員 · 你打過 {played} 位", { count: squad.memberCount, played: squad.playedWith }) : t("{count} 位隊員", { count: squad.memberCount })}</small></span></span>
        <Button variant="secondary" type="button" disabled={Boolean(joining)} onClick={() => onView(squad.id)}>{t("查看")}</Button>
        {signedIn && <Button type="button" loading={joining === squad.id} disabled={Boolean(joining)} onClick={() => void join(squad)}>{t("加入")}</Button>}
      </li>)}</ul>}
  </Sheet>;
}

function JoinSquad({ code, signedIn, onClose, onJoined }: { code: string | null; signedIn: boolean; onClose: () => void; onJoined: (id: string, name: string) => Promise<void> }) {
  const t = useT();
  const [preview, setPreview] = useState<{ id: string; name: string; memberCount: number } | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!code || !signedIn) return;
    call<{ squad: { id: string; name: string; memberCount: number } }>(`/api/squads/join?code=${encodeURIComponent(code)}`)
      .then(body => setPreview(body.squad)).catch(err => setError(err instanceof Error ? err.message : t("邀請連結無效或已更新。")));
  }, [code, signedIn, t]);
  if (!signedIn) {
    const remember = () => { try { if (code) sessionStorage.setItem(PENDING_JOIN_KEY, code); } catch { /* the link can simply be opened again */ } };
    return <Sheet open title={t("加入球隊")} onClose={onClose} className="squad-sheet">
      <p className="squad-hint">{t("請先登入會員帳戶，登入後會自動返到呢個邀請。")}</p>
      <div className="squad-sheet-actions"><a className="ds-button ds-button--primary" href="/login" onClick={remember}><span>{t("登入")}</span></a></div>
    </Sheet>;
  }
  const join = async () => {
    if (!code || !preview) return;
    setBusy(true); setError("");
    try { await call("/api/squads/join", { method: "POST", body: JSON.stringify({ code }) }); await onJoined(preview.id, preview.name); }
    catch (err) { setError(err instanceof Error ? err.message : t("未能加入球隊。")); setBusy(false); }
  };
  return <Sheet open title={t("加入球隊")} onClose={() => !busy && onClose()} className="squad-sheet">
    {error ? <InlineNotice tone="danger" title={t("未能完成")}>{error}</InlineNotice>
      : !preview ? <Skeleton height="3rem" />
      : <><p className="squad-join-name"><b>{preview.name}</b><small>{t("{count} 位隊員", { count: preview.memberCount })}</small></p>
        <p className="squad-hint">{t("加入後，你會出現喺呢個球隊嘅排名，隨時可以退出。")}</p>
        <div className="squad-sheet-actions"><Button type="button" loading={busy} onClick={() => void join()}>{t("加入球隊")}</Button></div></>}
  </Sheet>;
}

/* The manage sheet works in steps rather than as one long form: a calm overview (members, invite,
   settings as tappable rows), and a focused step for anything that edits or can't be undone —
   renaming, switching public/private, resetting the link, acting on one member, leaving, deleting.
   Nothing on the overview changes the squad on a single stray tap. */
type ManageView =
  | { kind: "overview" }
  | { kind: "rename" }
  | { kind: "member"; playerId: string }
  | { kind: "confirm"; title: string; body: string; label: string; danger?: boolean; key: string; action: () => Promise<unknown>; after?: "gone" };

const Chevron = () => <svg className="squad-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>;

function ManageSquad({ squad, players, ownPlayerId, refresh, onGone, onClose }: {
  squad: MySquad; players: Person[]; ownPlayerId: string; refresh: () => Promise<void>; onGone: () => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const isHost = squad.role === "host";
  const [view, setView] = useState<ManageView>({ kind: "overview" });
  const [name, setName] = useState(squad.name);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const [eligible, setEligible] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isHost) return;
    call<{ playerIds: string[] }>("/api/squads/eligible").then(body => setEligible(new Set(body.playerIds))).catch(() => setEligible(new Set()));
  }, [isHost]);
  /* Each step swaps the sheet's content, so move focus into it the way opening a sheet would. */
  useEffect(() => { bodyRef.current?.querySelector<HTMLElement>("input, button")?.focus(); }, [view.kind]);
  const byId = useMemo(() => new Map(players.map(player => [player.id, player])), [players]);
  const memberIds = useMemo(() => new Set(squad.members.map(member => member.playerId)), [squad.members]);
  const candidates = useMemo(() => eligible ? players.filter(player => eligible.has(player.id) && !memberIds.has(player.id)).sort((a, b) => a.name.localeCompare(b.name)) : [], [eligible, players, memberIds]);
  const hostCount = squad.members.filter(member => member.role === "host").length;
  const soleHost = isHost && hostCount === 1 && squad.members.length > 1;
  const nameOf = (id: string) => byId.get(id)?.name ?? t("已移除球員");

  const back = () => { setError(""); setView({ kind: "overview" }); };
  const run = async (key: string, action: () => Promise<unknown>, after: "stay" | "back" | "gone" = "back") => {
    setBusy(key); setError("");
    try {
      await action();
      if (after === "gone") { await onGone(); return; }
      await refresh();
      if (after === "back") setView({ kind: "overview" });
    }
    catch (err) { setError(err instanceof Error ? err.message : t("未能更新球隊，請稍後再試。")); }
    finally { setBusy(null); }
  };
  const base = `/api/squads/${encodeURIComponent(squad.id)}`;
  const patch = (body: object) => call(base, { method: "PATCH", body: JSON.stringify(body) });
  const removeCall = (playerId: string) => call(`${base}/members?playerId=${encodeURIComponent(playerId)}`, { method: "DELETE" });
  const roleCall = (playerId: string, role: SquadRole) => call(`${base}/members`, { method: "PATCH", body: JSON.stringify({ playerId, role }) });
  const confirm = (next: Omit<Extract<ManageView, { kind: "confirm" }>, "kind">) => { setError(""); setView({ kind: "confirm", ...next }); };
  const copyInvite = async () => {
    if (!squad.inviteCode) return;
    try { await navigator.clipboard.writeText(inviteUrl(squad.inviteCode)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError(t("未能複製，請長按連結自行複製。")); }
  };

  const toPublic = squad.visibility === "private";
  const title = view.kind === "rename" ? t("更改球隊名稱") : view.kind === "member" ? nameOf(view.playerId) : view.kind === "confirm" ? view.title : squad.name;
  const errorNotice = error && <InlineNotice tone="danger" title={t("未能完成")}>{error}</InlineNotice>;
  const backButton = <button type="button" className="squad-back" onClick={back} disabled={Boolean(busy)}>
    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m10 3-5 5 5 5" /></svg>{t("返回")}
  </button>;

  let body;
  if (view.kind === "rename") {
    body = <form className="squad-step" onSubmit={event => { event.preventDefault(); if (name.trim() && name.trim() !== squad.name) void run("name", () => patch({ name })); }}>
      {backButton}
      <FormField label={t("球隊名稱")} error={error || undefined}><input value={name} maxLength={SQUAD_NAME_MAX} autoComplete="off" onChange={event => setName(event.target.value)} /></FormField>
      <div className="squad-step-actions">
        <Button variant="secondary" type="button" onClick={() => { setName(squad.name); back(); }}>{t("取消")}</Button>
        <Button type="submit" loading={busy === "name"} disabled={!name.trim() || name.trim() === squad.name}>{t("儲存")}</Button>
      </div>
    </form>;
  } else if (view.kind === "member") {
    const member = squad.members.find(item => item.playerId === view.playerId);
    const label = nameOf(view.playerId), player = byId.get(view.playerId), self = view.playerId === ownPlayerId;
    body = <div className="squad-step">
      {backButton}
      {errorNotice}
      {!member ? <p className="squad-hint">{t("呢位球員已經唔喺球隊入面。")}</p> : <>
        <div className="squad-member-card">
          {player && <PlayerBadge player={player} />}
          <span><b>{label}</b><small>{member.role === "host" ? t("隊長") : t("隊員")}</small></span>
        </div>
        <div className="squad-action-list">
          {member.role === "host"
            ? <button type="button" className="squad-action" disabled={Boolean(busy) || hostCount === 1} onClick={() => void run(`role:${view.playerId}`, () => roleCall(view.playerId, "member"))}>
                <span><b>{t("改為隊員")}</b><small>{hostCount === 1 ? t("球隊最少要有一位隊長。") : t("之後唔可以再管理球隊。")}</small></span></button>
            : <button type="button" className="squad-action" disabled={Boolean(busy)} onClick={() => void run(`role:${view.playerId}`, () => roleCall(view.playerId, "host"))}>
                <span><b>{t("升為隊長")}</b><small>{t("可以管理隊員、邀請連結同設定。")}</small></span></button>}
          {!self && <button type="button" className="squad-action squad-action--danger" disabled={Boolean(busy)}
            onClick={() => confirm({ title: t("移除 {name}？", { name: label }), body: t("{name} 會喺呢個球隊消失，但可以經邀請連結重新加入。", { name: label }), label: t("移除"), danger: true, key: `remove:${view.playerId}`, action: () => removeCall(view.playerId) })}>
            <span><b>{t("移出球隊")}</b></span></button>}
        </div>
      </>}
    </div>;
  } else if (view.kind === "confirm") {
    body = <div className="squad-step squad-confirm">
      {backButton}
      <p>{view.body}</p>
      {errorNotice}
      <div className="squad-step-actions">
        <Button variant="secondary" type="button" disabled={Boolean(busy)} onClick={back}>{t("取消")}</Button>
        <Button variant={view.danger ? "danger" : "primary"} type="button" loading={busy === view.key}
          onClick={() => void run(view.key, view.action, view.after === "gone" ? "gone" : "back")}>{view.label}</Button>
      </div>
    </div>;
  } else {
    body = <>
      <p className="squad-manage-meta"><SquadBadges squad={squad} /><span>{t("{count} 位隊員", { count: squad.memberCount })}</span></p>
      {errorNotice}

      {isHost && squad.inviteCode && <section className="squad-card squad-invite" aria-labelledby="squad-invite-title">
        <div className="squad-card-head"><h3 id="squad-invite-title">{t("邀請朋友")}</h3><small>{t("收到連結嘅會員可以自行加入。")}</small></div>
        <div className="squad-invite-row">
          <code className="squad-invite-link" title={inviteUrl(squad.inviteCode)}>{inviteUrl(squad.inviteCode).replace(/^https?:\/\//, "")}</code>
          <Button type="button" onClick={() => void copyInvite()}>{copied ? t("已複製") : t("複製連結")}</Button>
        </div>
      </section>}

      <section className="squad-section" aria-labelledby="squad-members-title">
        <h3 id="squad-members-title">{t("隊員")} <span className="squad-count">{squad.memberCount}</span></h3>
        {isHost && <div className="squad-add">
          {eligible === null ? <Skeleton height="2.75rem" /> : <PlayerCombobox players={candidates} value="" placeholder={t("＋ 加入已登記會員")} ariaLabel={t("加入隊員")}
            onChange={id => id && void run(`add:${id}`, () => call(`${base}/members`, { method: "POST", body: JSON.stringify({ playerId: id }) }), "stay")} />}
          <small>{t("佢哋會收到通知，並可隨時退出。")}</small>
        </div>}
        <ul className="squad-members">{squad.members.map(member => {
          const player = byId.get(member.playerId), self = member.playerId === ownPlayerId, label = nameOf(member.playerId);
          const manageable = isHost && (!self || hostCount > 1);
          return <li key={member.playerId}>
            {player ? <PlayerBadge player={player} /> : <span className="squad-badge-placeholder" aria-hidden="true" />}
            <span className="squad-member-name"><b>{label}</b>{self && <small>{t("（你）")}</small>}</span>
            {member.role === "host" && <Chip tone="accent">{t("隊長")}</Chip>}
            {manageable && <IconButton type="button" className="squad-more" label={t("管理 {name}", { name: label })} disabled={Boolean(busy)} onClick={() => { setError(""); setView({ kind: "member", playerId: member.playerId }); }}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
            </IconButton>}
          </li>;
        })}</ul>
      </section>

      {isHost && <section className="squad-section" aria-labelledby="squad-settings-title">
        <h3 id="squad-settings-title">{t("球隊設定")}</h3>
        <div className="squad-settings">
          <button type="button" className="squad-setting" onClick={() => { setName(squad.name); setError(""); setView({ kind: "rename" }); }}>
            <span>{t("球隊名稱")}</span><b>{squad.name}</b><Chevron />
          </button>
          <button type="button" className="squad-setting" onClick={() => confirm({
            title: toPublic ? t("改為公開球隊？") : t("改為私人球隊？"),
            body: toPublic ? t("任何會員都可以喺「瀏覽公開球隊」搵到呢個球隊，一按就加入。") : t("球隊會喺公開列表消失，之後只可以經邀請連結或由隊長加入。現有隊員不受影響。"),
            label: toPublic ? t("改為公開") : t("改為私人"), key: "visibility", action: () => patch({ visibility: toPublic ? "public" : "private" }),
          })}>
            <span>{t("公開程度")}</span><b>{squad.visibility === "public" ? t("公開") : t("私人")}</b><Chevron />
          </button>
          <button type="button" className="squad-setting" onClick={() => confirm({
            title: t("重設邀請連結？"), body: t("舊連結會即時失效，未加入嘅人要用新連結。"), label: t("重設連結"), key: "rotate", action: () => patch({ rotateInvite: true }),
          })}>
            <span>{t("重設邀請連結")}</span><b /><Chevron />
          </button>
        </div>
      </section>}

      <section className="squad-section squad-danger">
        {soleHost && <p className="squad-hint">{t("你係唯一隊長，退出前請先將另一位隊員升為隊長。")}</p>}
        <div className="squad-danger-actions">
          <button type="button" className="squad-text-action" disabled={soleHost || Boolean(busy)} onClick={() => confirm(squad.members.length === 1
            ? { title: t("退出並解散球隊？"), body: t("你係最後一位隊員，退出後球隊會被刪除。"), label: t("退出並解散"), danger: true, key: "leave", action: () => removeCall(ownPlayerId), after: "gone" }
            : { title: t("退出「{squad}」？", { squad: squad.name }), body: t("你會喺球隊排名消失。之後可以經邀請連結重新加入。"), label: t("退出球隊"), danger: true, key: "leave", action: () => removeCall(ownPlayerId), after: "gone" })}>
            {t("退出球隊")}
          </button>
          {isHost && <button type="button" className="squad-text-action squad-text-action--danger" disabled={Boolean(busy)} onClick={() => confirm({
            title: t("刪除「{squad}」？", { squad: squad.name }), body: t("所有隊員會即時失去呢個球隊，無法復原。比賽紀錄同 ELO 不受影響。"), label: t("刪除球隊"), danger: true, key: "delete", action: () => call(base, { method: "DELETE" }), after: "gone",
          })}>{t("刪除球隊")}</button>}
        </div>
      </section>
    </>;
  }

  return <Sheet open title={title} onClose={() => !busy && onClose()} className="squad-sheet squad-manage">
    <div ref={bodyRef} className="squad-manage-body">{body}</div>
  </Sheet>;
}

export type { MySquad, SquadDetail };
