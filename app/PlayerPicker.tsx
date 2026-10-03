"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PlayerBadge } from "./UiBits";
import { Sheet } from "./components/ui/Overlay";
import { useT } from "./components/I18nProvider";

type PickerPlayer = { id: string; name: string; short?: string | null; colour?: string | null; avatar?: string | null; rating: number };
type PickerSquad = { id: string; name: string; members: { playerId: string }[] };
export type RecentOpponent = { id: string; playedOn: string };

/**
 * "Choose a player" sheet for the match form. The trigger is whatever the form renders (avatar + name +
 * ELO); tapping it opens a sheet with search, a squad filter, the viewer's recent opponents and then
 * everyone A–Z. Rows carry ELO and squad so two players with the same name can be told apart.
 * The squad choice is owned by the caller so it carries over from one slot to the next.
 */
export function PlayerPicker<P extends PickerPlayer>({ players, value, onChange, placeholder, ariaLabel, renderTrigger, autoOpenSignal, squads, squadId, onSquadChange, recent }: {
  players: P[]; value: string; onChange: (id: string) => void;
  /** Doubles as the sheet title ("Choose a player", "Choose a teammate"). */
  placeholder: string; ariaLabel: string;
  renderTrigger: (selected: P | undefined, open: () => void) => ReactNode;
  autoOpenSignal?: number;
  squads: PickerSquad[]; squadId: string | null; onSquadChange: (id: string | null) => void;
  recent: RecentOpponent[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = players.find(player => player.id === value);
  const startOpen = () => { setQuery(""); setOpen(true); };
  useEffect(() => { if (autoOpenSignal) startOpen(); }, [autoOpenSignal]);

  const squadsByPlayer = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const squad of squads) for (const member of squad.members) map.set(member.playerId, [...(map.get(member.playerId) ?? []), squad.name]);
    return map;
  }, [squads]);
  const squad = squads.find(item => item.id === squadId) ?? null;
  const inSquad = useMemo(() => (squad ? new Set(squad.members.map(member => member.playerId)) : null), [squad]);
  const scoped = useMemo(() => players.filter(player => !inSquad || inSquad.has(player.id)), [players, inSquad]);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => needle
    ? scoped.filter(player => `${player.name} ${player.short ?? ""} ${(squadsByPlayer.get(player.id) ?? []).join(" ")}`.toLowerCase().includes(needle))
    : scoped, [scoped, needle, squadsByPlayer]);
  const recentRows = useMemo(() => {
    if (needle) return [];
    const byId = new Map(scoped.map(player => [player.id, player]));
    return recent.flatMap(item => { const player = byId.get(item.id); return player ? [{ player, playedOn: item.playedOn }] : []; }).slice(0, 5);
  }, [recent, scoped, needle]);

  const pick = (id: string) => { onChange(id); setOpen(false); };
  const row = (player: P, playedOn?: string) => {
    const squadNames = (squadsByPlayer.get(player.id) ?? []).slice(0, 2).join(" · ");
    const detail = [`${Math.round(player.rating)} ELO`, playedOn ? t("上次對賽 {date}", { date: playedOn }) : squadNames].filter(Boolean).join(" · ");
    return <li key={`${playedOn ? "r" : "a"}-${player.id}`}>
      <button type="button" className="player-picker__row" aria-pressed={player.id === value} onClick={() => pick(player.id)}>
        <PlayerBadge player={player} className="player-picker__avatar" />
        <span><b>{player.name}</b><small>{detail}</small></span>
        {player.id === value && <i aria-hidden="true">✓</i>}
      </button>
    </li>;
  };

  return <>
    {renderTrigger(selected, startOpen)}
    <Sheet open={open} title={placeholder} onClose={() => setOpen(false)} className="player-picker">
      <div className="player-picker__head">
        <input type="search" role="searchbox" aria-label={ariaLabel} placeholder={t("搜尋姓名或縮寫")} autoComplete="off" autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
          value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && matches.length === 1) { pick(matches[0].id); event.preventDefault(); } }} />
        {squads.length > 0 && <div className="player-picker__squads" role="group" aria-label={t("選擇球隊")}>
          <button type="button" className={!squad ? "active" : ""} aria-pressed={!squad} onClick={() => onSquadChange(null)}>{t("全部")}</button>
          {squads.map(item => <button type="button" key={item.id} className={squad?.id === item.id ? "active" : ""} aria-pressed={squad?.id === item.id} onClick={() => onSquadChange(item.id)}>{item.name}</button>)}
        </div>}
      </div>
      <div className="player-picker__list">
        {matches.length === 0 ? <p className="player-picker__empty">{t("沒有符合的球員")}</p> : <>
          {recentRows.length > 0 && <section aria-label={t("最近對手")}><h3>{t("最近對手")}</h3><ul>{recentRows.map(item => row(item.player, item.playedOn))}</ul></section>}
          <section aria-label={t("全部球員")}>{!needle && <h3>{t("全部球員")}</h3>}<ul>{matches.map(player => row(player))}</ul></section>
        </>}
      </div>
    </Sheet>
  </>;
}
