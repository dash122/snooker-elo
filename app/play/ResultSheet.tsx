"use client";
import { useState } from "react";
import { Button, InlineNotice } from "../components/ui/Primitives";
import { Sheet } from "../components/ui/Overlay";
import { useT } from "../components/I18nProvider";
import type { SessionDto } from "../../lib/play/dashboard";
import { headToHead, proposeHandicap, type HandicapSettings, type PastMatch } from "../../lib/handicap";
import type { ActionResult } from "./usePlay";

/* Recording is trust-based and immediate: pick two players, enter the frames, and both ratings move.
   Nobody has to confirm. Handicap is offered from the ratings so neither player has to raise it. */

type Person = { id: string; name: string; rating: number };
type Recorded = { before: Record<string, number>; after: Record<string, number>; a: string; b: string; scoreA: number; scoreB: number };

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div className="play-stepper" role="group" aria-label={label}>
      <span className="play-label">{label}</span>
      <div>
        <button type="button" aria-label={t("減少")} disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={t("增加")} disabled={value >= 99} onClick={() => onChange(value + 1)}>＋</button>
      </div>
    </div>
  );
}

export default function ResultSheet({ session, players, ownPlayerId, settings, matches, results, onClose, onRecorded, onRematch }: {
  session: SessionDto; players: Person[]; ownPlayerId: string; settings: HandicapSettings; matches: PastMatch[];
  results: (values: Record<string, unknown>) => Promise<ActionResult & Record<string, unknown>>;
  onClose: () => void; onRecorded: () => void; onRematch: (opponentId: string) => void;
}) {
  const t = useT();
  const going = session.members.filter((m) => m.confidence !== "maybe").map((m) => m.player);
  const ids = going.map((p) => p.id);
  const [a, setA] = useState(ids.includes(ownPlayerId) ? ownPlayerId : ids[0] ?? "");
  const [b, setB] = useState(ids.find((id) => id !== (ids.includes(ownPlayerId) ? ownPlayerId : ids[0])) ?? "");
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [giver, setGiver] = useState("");
  const [points, setPoints] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [similar, setSimilar] = useState<{ scoreA: number; scoreB: number } | null>(null);
  const [done, setDone] = useState<Recorded | null>(null);

  const player = (id: string) => going.find((p) => p.id === id) ?? players.find((p) => p.id === id);
  const pa = player(a), pb = player(b);
  const proposal = pa && pb ? proposeHandicap(t, pa.rating, pb.rating, settings) : null;
  const valid = !!pa && !!pb && a !== b && scoreA + scoreB > 0;

  function applySuggested() {
    if (!proposal || !pa || !pb) return;
    setGiver(proposal.points > 0 ? a : proposal.points < 0 ? b : "");
    setPoints(Math.abs(proposal.points));
  }

  async function submit(another = false) {
    if (!valid || !pa || !pb) return;
    setPending(true);
    setError("");
    const body = await results({ action: "record", sessionId: session.id, a, b, scoreA, scoreB, giver: giver || null, points, another });
    setPending(false);
    if (!body.ok) { setError(String(body.error ?? t("賽果暫時未能儲存，請稍後再試。"))); return; }
    if (body.status === "similar") { setSimilar({ scoreA: Number((body.similar as { scoreA: number }).scoreA), scoreB: Number((body.similar as { scoreB: number }).scoreB) }); return; }
    setSimilar(null);
    setDone({ before: body.before as Record<string, number>, after: body.after as Record<string, number>, a, b, scoreA, scoreB });
    onRecorded();
  }

  if (done) {
    const winner = done.scoreA === done.scoreB ? null : done.scoreA > done.scoreB ? done.a : done.b;
    const other = done.a === ownPlayerId ? done.b : done.b === ownPlayerId ? done.a : null;
    const record = other ? headToHead(t, matches, ownPlayerId, other) : null;
    return (
      <Sheet open title={t("賽果已記錄")} onClose={onClose} className="play-sheet">
        <div className="play-form">
          <p className="play-score">{player(done.a)?.name} <b>{done.scoreA}–{done.scoreB}</b> {player(done.b)?.name}</p>
          <ul className="play-people">
            {[done.a, done.b].map((id) => {
              const delta = (done.after[id] ?? 0) - (done.before[id] ?? 0);
              return <li key={id}><span>{player(id)?.name}{winner === id ? " 🏆" : ""}</span><small>{Math.round(done.before[id])} → {Math.round(done.after[id])}</small><b className={delta >= 0 ? "play-up" : "play-down"}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}</b></li>;
            })}
          </ul>
          {record?.label && <p className="play-meta">{record.label}</p>}
          <div className="play-actions">
            <Button type="button" variant="secondary" onClick={() => { setDone(null); setScoreA(0); setScoreB(0); }}>{t("再記一場")}</Button>
            {other && <Button type="button" variant="featured" onClick={() => onRematch(other)}>{t("再約 {name}", { name: player(other)?.name ?? "" })}</Button>}
            <Button type="button" onClick={onClose}>{t("完成")}</Button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open title={t("記錄賽果")} onClose={onClose} className="play-sheet">
      <div className="play-form">
        <div className="play-versus">
          <label className="ds-field"><span>{t("球員 A")}</span>
            <select value={a} onChange={(e) => setA(e.target.value)}>{going.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="ds-field"><span>{t("球員 B")}</span>
            <select value={b} onChange={(e) => setB(e.target.value)}>{going.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </div>
        <div className="play-scores">
          <Stepper label={`${pa?.name ?? "A"} ${t("局數")}`} value={scoreA} onChange={setScoreA} />
          <Stepper label={`${pb?.name ?? "B"} ${t("局數")}`} value={scoreB} onChange={setScoreB} />
        </div>
        {a === b && <InlineNotice tone="warning" title={t("請選擇兩位不同的球員")}>{t("A 與 B 不可以是同一個人。")}</InlineNotice>}

        {proposal && (
          <div className="play-handicap">
            <p className="play-meta">{giver ? t("{name} 讓 {points} 分", { name: player(giver)?.name ?? "", points }) : t("未設定讓分（平手對戰）")}</p>
            <Button type="button" variant="quiet" onClick={applySuggested}>{proposal.label}</Button>
            {giver && <Button type="button" variant="quiet" onClick={() => { setGiver(""); setPoints(0); }}>{t("清除讓分")}</Button>}
          </div>
        )}

        {similar && (
          <InlineNotice tone="warning" title={t("似乎已有人記錄")}>
            {t("已有一場 {a}–{b} 的賽果。是同一場，還是另一場？", { a: similar.scoreA, b: similar.scoreB })}
            <Button type="button" variant="secondary" onClick={onClose}>{t("同一場（不再記錄）")}</Button>
            <Button type="button" onClick={() => void submit(true)}>{t("另一場")}</Button>
          </InlineNotice>
        )}
        {error && <InlineNotice tone="danger" title={t("未能儲存")}>{error}</InlineNotice>}
        <div className="play-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t("取消")}</Button>
          <Button type="button" loading={pending} disabled={!valid || !!similar} onClick={() => void submit()}>{t("儲存賽果")}</Button>
        </div>
        <p className="play-meta">{t("賽果即時生效，雙方 ELO 即時更新，毋須對方確認。")}</p>
      </div>
    </Sheet>
  );
}
