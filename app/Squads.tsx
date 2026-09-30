"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  useEffect(() => { if (id) trackAvailabilityEvent("squad_view", { squadId: id, memberCount: size }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The one control the ranking panel carries: names the current view and opens the picker. */
export function SquadScopeChip({ squad, onOpen, onManage }: { squad: MySquad | null; onOpen: () => void; onManage: () => void }) {
  const t = useT();
  return <div className="squad-scope">
    <button type="button" className="squad-scope-chip" aria-haspopup="dialog" onClick={onOpen}>
      <span className="squad-scope-kicker">{t("球隊篩選")}</span>
      <b>{squad ? squad.name : t("全會")}</b>
      <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {squad && <Button variant="secondary" className="squad-scope-manage" type="button" onClick={onManage}>{squad.role === "host" ? t("管理球隊") : t("球隊資料")}</Button>}
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
    {sheet === "picker" && <SquadPicker squads={squads} loaded={loaded} selectedId={selectedId} onSelect={id => { onSelect(id); close(); }} onBrowse={() => setSheet("browse")} onCreate={() => setSheet("create")} onClose={close} />}
    {sheet === "create" && <CreateSquad onClose={close} onCreated={async id => { await refresh(); onSelect(id); setSheet("manage"); }} />}
    {sheet === "browse" && <BrowseSquads onClose={close} onJoined={async (id, name) => { await refresh(); onSelect(id); close(); notify(name); }} />}
    {joinCode && <JoinSquad code={joinCode} signedIn={signedIn} onClose={clearJoinCode} onJoined={async (id, name) => { clearJoinCode(); await refresh(); onSelect(id); notify(name); }} />}
    {sheet === "manage" && selected && ownPlayerId && <ManageSquad squad={selected} players={players} ownPlayerId={ownPlayerId} refresh={refresh}
      onGone={async () => { onSelect(null); close(); await refresh(); }} onClose={close} />}
  </>;
}

function SquadPicker({ squads, loaded, selectedId, onSelect, onBrowse, onCreate, onClose }: {
  squads: MySquad[]; loaded: boolean; selectedId: string | null; onSelect: (id: string | null) => void; onBrowse: () => void; onCreate: () => void; onClose: () => void;
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
    {loaded && !squads.length && <p className="squad-hint">{t("組個球隊，同經常打波嘅朋友睇自己嘅排名。")}</p>}
    <div className="squad-sheet-actions">
      <Button variant="secondary" type="button" onClick={onBrowse}>{t("瀏覽公開球隊")}</Button>
      <Button type="button" onClick={onCreate}>{t("建立球隊")}</Button>
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

function BrowseSquads({ onClose, onJoined }: { onClose: () => void; onJoined: (id: string, name: string) => Promise<void> }) {
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
        <Button variant="secondary" type="button" loading={joining === squad.id} disabled={Boolean(joining)} onClick={() => void join(squad)}>{t("加入")}</Button>
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

function ManageSquad({ squad, players, ownPlayerId, refresh, onGone, onClose }: {
  squad: MySquad; players: Person[]; ownPlayerId: string; refresh: () => Promise<void>; onGone: () => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const isHost = squad.role === "host";
  const [name, setName] = useState(squad.name);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const [eligible, setEligible] = useState<Set<string> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!isHost) return;
    call<{ playerIds: string[] }>("/api/squads/eligible").then(body => setEligible(new Set(body.playerIds))).catch(() => setEligible(new Set()));
  }, [isHost]);
  const byId = useMemo(() => new Map(players.map(player => [player.id, player])), [players]);
  const memberIds = useMemo(() => new Set(squad.members.map(member => member.playerId)), [squad.members]);
  const candidates = useMemo(() => eligible ? players.filter(player => eligible.has(player.id) && !memberIds.has(player.id)).sort((a, b) => a.name.localeCompare(b.name)) : [], [eligible, players, memberIds]);
  const hostCount = squad.members.filter(member => member.role === "host").length;

  const run = async (key: string, action: () => Promise<unknown>, after: () => Promise<void> = refresh) => {
    setBusy(key); setError("");
    try { await action(); await after(); }
    catch (err) { setError(err instanceof Error ? err.message : t("未能更新球隊，請稍後再試。")); }
    finally { setBusy(null); }
  };
  const base = `/api/squads/${encodeURIComponent(squad.id)}`;
  const patch = (body: object) => call(base, { method: "PATCH", body: JSON.stringify(body) });
  const setRole = (playerId: string, role: SquadRole) => run(`role:${playerId}`, () => call(`${base}/members`, { method: "PATCH", body: JSON.stringify({ playerId, role }) }));
  const remove = (playerId: string) => run(`remove:${playerId}`, () => call(`${base}/members?playerId=${encodeURIComponent(playerId)}`, { method: "DELETE" }));
  const leave = () => run("leave", () => call(`${base}/members?playerId=${encodeURIComponent(ownPlayerId)}`, { method: "DELETE" }), onGone);
  const copyInvite = async () => {
    if (!squad.inviteCode) return;
    try { await navigator.clipboard.writeText(inviteUrl(squad.inviteCode)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError(t("未能複製，請長按連結自行複製。")); }
  };
  const soleHost = isHost && hostCount === 1 && squad.members.length > 1;

  return <Sheet open title={squad.name} onClose={() => !busy && onClose()} className="squad-sheet squad-manage">
    <p className="squad-manage-meta"><SquadBadges squad={squad} /><span>{t("{count} 位隊員", { count: squad.memberCount })}</span></p>
    {error && <InlineNotice tone="danger" title={t("未能完成")}>{error}</InlineNotice>}

    {isHost && <section className="squad-section" aria-labelledby="squad-settings-title">
      <h3 id="squad-settings-title">{t("球隊設定")}</h3>
      <form className="squad-inline-form" onSubmit={event => { event.preventDefault(); void run("name", () => patch({ name })); }}>
        <FormField label={t("球隊名稱")}><input value={name} maxLength={SQUAD_NAME_MAX} autoComplete="off" onChange={event => setName(event.target.value)} /></FormField>
        <Button variant="secondary" type="submit" loading={busy === "name"} disabled={!name.trim() || name.trim() === squad.name}>{t("儲存")}</Button>
      </form>
      <VisibilityControl value={squad.visibility} onChange={visibility => void run("visibility", () => patch({ visibility }))} />
      {squad.inviteCode && <div className="squad-invite">
        <FormField label={t("邀請連結")} hint={t("收到連結嘅會員可以自行加入。重設後舊連結即時失效。")}><input readOnly value={inviteUrl(squad.inviteCode)} onFocus={event => event.currentTarget.select()} /></FormField>
        <div className="squad-invite-actions">
          <Button variant="secondary" type="button" onClick={() => void copyInvite()}>{copied ? t("已複製") : t("複製連結")}</Button>
          <Button variant="quiet" type="button" loading={busy === "rotate"} onClick={() => void run("rotate", () => patch({ rotateInvite: true }))}>{t("重設連結")}</Button>
        </div>
      </div>}
    </section>}

    <section className="squad-section" aria-labelledby="squad-members-title">
      <h3 id="squad-members-title">{t("隊員")}</h3>
      {isHost && <div className="squad-add">
        {eligible === null ? <Skeleton height="2.75rem" /> : <PlayerCombobox players={candidates} value="" placeholder={t("加入已登記會員…")} ariaLabel={t("加入隊員")}
          onChange={id => id && void run(`add:${id}`, () => call(`${base}/members`, { method: "POST", body: JSON.stringify({ playerId: id }) }))} />}
        <small>{t("只可以加入已登記帳戶嘅會員；佢哋會收到通知，並可隨時退出。")}</small>
      </div>}
      <ul className="squad-members">{squad.members.map(member => {
        const player = byId.get(member.playerId), self = member.playerId === ownPlayerId;
        const label = player?.name ?? t("已移除球員");
        return <li key={member.playerId}>
          {player && <PlayerBadge player={player} />}
          <span className="squad-member-name"><b>{label}{self && <small>{t("（你）")}</small>}</b>{member.role === "host" && <Chip tone="accent">{t("隊長")}</Chip>}</span>
          {isHost && !self && <span className="squad-member-actions">
            {member.role === "host"
              ? <Button variant="quiet" type="button" loading={busy === `role:${member.playerId}`} disabled={Boolean(busy)} onClick={() => void setRole(member.playerId, "member")}>{t("改為隊員")}</Button>
              : <Button variant="quiet" type="button" loading={busy === `role:${member.playerId}`} disabled={Boolean(busy)} onClick={() => void setRole(member.playerId, "host")}>{t("升為隊長")}</Button>}
            <Button variant="quiet" type="button" aria-label={t("移除 {name}", { name: label })} loading={busy === `remove:${member.playerId}`} disabled={Boolean(busy)} onClick={() => void remove(member.playerId)}>{t("移除")}</Button>
          </span>}
          {isHost && self && hostCount > 1 && <span className="squad-member-actions">
            <Button variant="quiet" type="button" loading={busy === `role:${member.playerId}`} disabled={Boolean(busy)} onClick={() => void setRole(member.playerId, "member")}>{t("改為隊員")}</Button>
          </span>}
        </li>;
      })}</ul>
    </section>

    <section className="squad-section squad-danger">
      {soleHost && <p className="squad-hint">{t("你係唯一隊長，退出前請先將另一位隊員升為隊長。")}</p>}
      <div className="squad-sheet-actions">
        <Button variant="secondary" type="button" loading={busy === "leave"} disabled={soleHost || Boolean(busy)} onClick={() => void leave()}>{squad.members.length === 1 ? t("退出並解散球隊") : t("退出球隊")}</Button>
        {isHost && (confirmDelete
          ? <Button variant="danger" type="button" loading={busy === "delete"} onClick={() => void run("delete", () => call(base, { method: "DELETE" }), onGone)}>{t("確定刪除？")}</Button>
          : <Button variant="quiet" type="button" onClick={() => setConfirmDelete(true)}>{t("刪除球隊")}</Button>)}
      </div>
    </section>
  </Sheet>;
}

export type { MySquad, SquadDetail };
