"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { useT } from "../components/I18nProvider";
import { LanguageMenu } from "../components/shell/LanguageMenu";
import { Button, ButtonLink, FormField, StatTile, Surface } from "../components/ui/Primitives";
import {
  HANDICAP_CURVE_MODEL_VERSION, HANDICAP_MODEL_VERSION, HANDICAP_TAPER_ANCHORS, matchHandicapRate, proposeHandicap, suggestedHandicap,
  taperEloForPoints, taperEloPerPoint, taperPoints, type HandicapSettings,
} from "../../lib/handicap";
import { calculateSnookerElo } from "../../lib/snooker-elo";
import { msg } from "../../lib/i18n/translate";

/* Every number on this page comes from the same functions the club's rating engine runs, so the
   guide cannot drift from what the leaderboard and the match form actually do. */
const CURVE: HandicapSettings & { start: number } = {
  handicapPointsToElo: 25, handicapMinimumElo: 7, handicapSensitivityRange: 16, handicapSensitivityWidth: 250,
  start: 1500, modelVersion: HANDICAP_MODEL_VERSION,
};
const FLAT: HandicapSettings & { start: number } = { ...CURVE, modelVersion: HANDICAP_CURVE_MODEL_VERSION - 1 };
const LOW_RATE = HANDICAP_TAPER_ANCHORS[0][1];
const HIGH_RATE = HANDICAP_TAPER_ANCHORS[HANDICAP_TAPER_ANCHORS.length - 1][1];

/** One match through the real engine. `given` is the head start side A gives (negative: receives). */
function engine(ratingA: number, ratingB: number, given: number, framesA = 0, framesB = 0) {
  return calculateSnookerElo({
    ratingA, ratingB, handicapA: -given, framesA, framesB, handicapEloScale: 1250,
    handicapEloPerPoint: matchHandicapRate(ratingA, ratingB, given, CURVE),
  });
}
const pct = (share: number) => `${Math.round(share * 100)}%`;
const whole = (value: number) => String(Math.round(value));
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value))}`;

/** `**bold**` inside a translated sentence, so a number can stand out without splitting the sentence in two. */
function Rich({ text }: { text: string }) {
  return <>{text.split("**").map((part, index) => (index % 2 ? <b key={index} className="guide-num">{part}</b> : part))}</>;
}

/** Width of an element, so a chart can draw at its real pixel size and keep its text legible on a phone. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setWidth(Math.max(280, Math.round(node.getBoundingClientRect().width)));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Range({ label, side, value, min, max, step = 1, display, onChange, wide = false }: {
  label: string; side?: "strong" | "weak"; value: number; min: number; max: number; step?: number;
  display?: string; onChange: (value: number) => void; wide?: boolean;
}) {
  const id = useId();
  return <div className={`guide-ctl${wide ? " guide-ctl--wide" : ""}`}>
    <label htmlFor={id}>
      <span>{side && <i className={`guide-dot guide-dot--${side}`} aria-hidden="true" />}{label}</span>
      <output htmlFor={id} className="guide-num">{display ?? value}</output>
    </label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </div>;
}

/** Stronger player in blue, weaker in orange, always in that order. */
function TwoBar({ share, label, faded = false }: { share: number; label: string; faded?: boolean }) {
  return <div className={`guide-bar${faded ? " is-faded" : ""}`} role="img" aria-label={label}>
    <i className="guide-bar__strong" style={{ width: `${share * 100}%` }}>{share > 0.12 ? pct(share) : ""}</i>
    <i className="guide-bar__weak" style={{ width: `${(1 - share) * 100}%` }}>{1 - share > 0.12 ? pct(1 - share) : ""}</i>
  </div>;
}

function Legend() {
  const t = useT();
  return <div className="guide-legend">
    <span><i className="guide-dot guide-dot--strong" aria-hidden="true" />{t("較強的一方")}</span>
    <span><i className="guide-dot guide-dot--weak" aria-hidden="true" />{t("較弱的一方")}</span>
  </div>;
}

function Chapter({ id, tag, title, children }: { id: string; tag: string; title: string; children: ReactNode }) {
  return <section className="guide-chapter" id={id}>
    <div className="guide-wrap"><p className="guide-tag">{tag}</p><h2>{title}</h2></div>
    {children}
  </section>;
}

/* ---- chapter 1 ---------------------------------------------------------------------------- */
const GAPS = [0, 100, 200, 400, 800, 1200];

function GapBars() {
  const t = useT();
  return <Surface as="div" className="guide-lab">
    <h3>{t("評分相差多少，強者預期贏多少局？")}</h3>
    <Legend />
    <div className="guide-gaps">
      {GAPS.map(gap => {
        const share = engine(1500 + gap / 2, 1500 - gap / 2, 0).probabilityA;
        return <div className="guide-gap" key={gap}>
          <span>{gap === 0 ? t("評分相同") : t("高 {gap} 點", { gap })}</span>
          <TwoBar share={share} label={t("強者預期贏 {share}", { share: pct(share) })} />
        </div>;
      })}
    </div>
    <p className="guide-note">{t("例子：評分高 400 點的球友，每三局預期贏約兩局。")}</p>
  </Surface>;
}

/* ---- chapter 2 ---------------------------------------------------------------------------- */
function Simulator() {
  const t = useT();
  const [mine, setMine] = useState(1500);
  const [theirs, setTheirs] = useState(1900);
  const [won, setWon] = useState(2);
  const [lost, setLost] = useState(2);
  const result = engine(mine, theirs, 0, won, lost);
  const frames = won + lost;
  const change = result.deltaA;
  const direction = change > 0.5 ? "up" : change < -0.5 ? "down" : "flat";
  const verdict = direction === "up" ? t("比預期好") : direction === "down" ? t("比預期差") : t("與預期相若");
  return <Surface as="div" className="guide-lab">
    <h3>{t("評分模擬器")}</h3>
    <div className="guide-grid">
      <Range label={t("你的評分")} side="strong" value={mine} min={800} max={2200} step={10} onChange={setMine} />
      <Range label={t("對手評分")} side="weak" value={theirs} min={800} max={2200} step={10} onChange={setTheirs} />
      <Range label={t("你贏的局數")} side="strong" value={won} min={0} max={10} onChange={setWon} />
      <Range label={t("對手贏的局數")} side="weak" value={lost} min={0} max={10} onChange={setLost} />
    </div>
    <div className="guide-compare">
      <p className="guide-cap">{t("賽前預期（按評分）")}</p>
      <TwoBar share={result.probabilityA} label={t("預期你贏 {share}", { share: pct(result.probabilityA) })} />
      <p className="guide-cap">{frames ? t("實際結果") : t("實際結果（請先選擇局數）")}</p>
      <TwoBar share={frames ? won / frames : 0.5} faded={!frames} label={frames ? t("實際你贏 {share}", { share: pct(won / frames) }) : t("實際結果（請先選擇局數）")} />
    </div>
    <div className="guide-verdict" aria-live="polite">
      {frames === 0
        ? t("至少要有一局，才能計算評分變動。")
        : <>
          <p><Rich text={t("預期你贏 **{expected}** 的局數，實際贏了 **{actual}**，{verdict}。", { expected: pct(result.probabilityA), actual: pct(won / frames), verdict })} /></p>
          <p><Rich text={t("你的評分：**{before}** → **{after}**", { before: whole(mine), after: whole(mine + change) })} />{" "}
            <span className={`guide-delta guide-delta--${direction}`}>{direction === "flat" ? "±0" : signed(change)}</span> {t("點")}</p>
        </>}
    </div>
  </Surface>;
}

/* ---- chapter 3 ---------------------------------------------------------------------------- */
function Scale() {
  const t = useT();
  const [strong, setStrong] = useState(1800);
  const [weak, setWeak] = useState(1000);
  const [start, setStart] = useState(0);
  const [boxRef, width] = useWidth();
  const top = Math.max(strong, weak);
  const gap = top - weak;
  const worth = taperEloForPoints(weak, start);
  const share = engine(top, weak, start).probabilityA;
  const suggested = proposeHandicap(t, top, weak, CURVE).points;
  const lean = Math.abs(share - 0.5);
  const verdict = lean <= 0.05 ? t("接近公平：雙方各有一半機會。") : share > 0.5 ? t("仍對較強者有利，可以再多讓一些。") : t("讓得太多，對較弱者有利。");

  const panWidth = width < 480 ? 108 : 124;
  const cx = width / 2, cy = 90, reach = Math.min(190, (width - panWidth - 14) / 2 / Math.cos(0.32));
  const tilt = Math.max(-18, Math.min(18, (share - 0.5) * 90)) * Math.PI / 180;
  const left = { x: cx - reach * Math.cos(tilt), y: cy + reach * Math.sin(tilt) };
  const right = { x: cx + reach * Math.cos(tilt), y: cy - reach * Math.sin(tilt) };
  const pans = [
    { at: left, side: "strong", label: t("實力差距"), value: whole(gap) },
    { at: right, side: "weak", label: t("讓分價值"), value: whole(worth) },
  ];
  return <Surface as="div" className="guide-lab">
    <h3>{t("天秤：實力差距對上讓分")}</h3>
    <div className="guide-grid">
      <Range label={t("較強者評分")} side="strong" value={strong} min={900} max={2200} step={10} onChange={setStrong} />
      <Range label={t("較弱者評分")} side="weak" value={weak} min={600} max={2100} step={10} onChange={setWeak} />
      <Range wide label={t("讓給較弱者的分數（每局）")} value={start} min={0} max={60} display={t("{n} 分", { n: start })} onChange={setStart} />
    </div>
    <div ref={boxRef} className="guide-chart">
      <svg width={width} height={272} viewBox={`0 0 ${width} 272`} role="img" aria-label={t("天秤：左邊是實力差距，右邊是讓分的價值，傾向較重的一方。")}>
        <path className="gs-stand" d={`M${cx} ${cy + 6} L${cx - 40} 252 L${cx + 40} 252 Z`} />
        <line className="gs-beam" x1={left.x} y1={left.y} x2={right.x} y2={right.y} />
        <circle className="gs-pivot" cx={cx} cy={cy} r={9} />
        {pans.map(pan => <g key={pan.side}>
          <line className="gs-string" x1={pan.at.x - panWidth / 2 + 8} y1={pan.at.y} x2={pan.at.x - panWidth / 2 + 8} y2={pan.at.y + 56} />
          <line className="gs-string" x1={pan.at.x + panWidth / 2 - 8} y1={pan.at.y} x2={pan.at.x + panWidth / 2 - 8} y2={pan.at.y + 56} />
          <rect className={`gs-pan gs-pan--${pan.side}`} x={pan.at.x - panWidth / 2} y={pan.at.y + 56} width={panWidth} height={56} rx={8} />
          <text x={pan.at.x} y={pan.at.y + 78} textAnchor="middle">{pan.label}</text>
          <text className="gs-figure" x={pan.at.x} y={pan.at.y + 102} textAnchor="middle">{pan.value}</text>
        </g>)}
      </svg>
    </div>
    <p className="guide-cap">{t("較強者每一局的預期贏面")}</p>
    <TwoBar share={share} label={t("較強者贏面 {share}", { share: pct(share) })} />
    <div className="guide-verdict" aria-live="polite">
      <p>{verdict}</p>
      <p><Rich text={t("建議讓分：**{n}** 分。", { n: suggested })} /></p>
    </div>
    <p><Button type="button" onClick={() => setStart(Math.min(60, suggested))}>{t("按建議讓分")}</Button></p>
  </Surface>;
}

/* ---- chapter 4 ---------------------------------------------------------------------------- */
function Worth() {
  const t = useT();
  const [level, setLevel] = useState(1100);
  const [boxRef, width] = useWidth();
  const x0 = 40, x1 = width - 14, y0 = 252, y1 = 52, rMin = 500, rMax = 2500;
  const x = (rating: number) => x0 + (rating - rMin) / (rMax - rMin) * (x1 - x0);
  const y = (value: number) => y0 - value / 80 * (y0 - y1);
  let path = "";
  for (let rating = rMin; rating <= rMax; rating += 20) path += `${rating === rMin ? "M" : "L"}${x(rating).toFixed(1)} ${y(taperEloPerPoint(rating)).toFixed(1)}`;
  const worth = taperEloPerPoint(level);
  const given = taperPoints(level, level + 400);
  return <Surface as="div" className="guide-lab">
    <h3>{t("一分約等於多少評分點？")}</h3>
    <div ref={boxRef} className="guide-chart">
      <svg width={width} height={322} viewBox={`0 0 ${width} 322`} role="img" aria-label={t("折線圖：水平愈高，一分值的評分點愈少，由約 {high} 降至 {low}。", { high: LOW_RATE, low: HIGH_RATE })}>
        <text x={x0} y={14}>{t("一分約等於多少評分點")}</text>
        {[0, 25, 50, 75].map(value => <g key={value}>
          <line className="gs-grid" x1={x0} y1={y(value)} x2={x1} y2={y(value)} />
          <text className="gs-tick" x={x0 - 8} y={y(value) + 4} textAnchor="end">{value}</text>
        </g>)}
        {[500, 1000, 1500, 2000, 2500].map(rating => <text className="gs-tick" key={rating} x={x(rating)} y={y0 + 22} textAnchor="middle">{rating}</text>)}
        <text x={(x0 + x1) / 2} y={y0 + 46} textAnchor="middle">{t("球友水平（評分）")}</text>
        <path className="gs-curve" d={path} />
        <text className="gs-label" x={x(520)} y={y(LOW_RATE) - 10}>{t("初學者：一分很重")}</text>
        <text className="gs-label" x={x(2490)} y={y(HIGH_RATE) + 26} textAnchor="end">{t("高手：一分很輕")}</text>
        <line className="gs-guide" x1={x(level)} y1={y1} x2={x(level)} y2={y0} />
        <circle className="gs-marker" cx={x(level)} cy={y(worth)} r={7} />
      </svg>
    </div>
    <Range label={t("選擇一個水平")} value={level} min={500} max={2500} step={10} onChange={setLevel} />
    <div className="guide-verdict" aria-live="polite">
      <p><Rich text={t("在評分 **{level}** 一帶，一分約等於 **{worth}** 評分點。與高出 400 點的對手對賽，讓分約 **{given}** 分（若每分固定 25 評分點，則需 **{flat}** 分）。", { level, worth: whole(worth), given: whole(given), flat: whole(400 / 25) })} /></p>
    </div>
  </Surface>;
}

/* ---- chapter 5 ---------------------------------------------------------------------------- */
const CAST = [
  { name: msg("球友甲"), short: msg("甲"), rating: 2100 }, { name: msg("球友乙"), short: msg("乙"), rating: 1800 },
  { name: msg("球友丙"), short: msg("丙"), rating: 1500 }, { name: msg("球友丁"), short: msg("丁"), rating: 1200 },
  { name: msg("球友戊"), short: msg("戊"), rating: 900 }, { name: msg("球友己"), short: msg("己"), rating: 600 },
];
const indexOf = (rating: number) => 60 - taperPoints(1500, rating);

function HandicapRuler() {
  const t = useT();
  const [giver, setGiver] = useState(0);
  const [receiver, setReceiver] = useState(5);
  const lo = 36, hi = 80;
  const same = giver === receiver;
  const first = CAST[giver], second = CAST[receiver];
  const [strong, weak] = first.rating >= second.rating ? [first, second] : [second, first];
  const swapped = first.rating < second.rating;
  const current = proposeHandicap(t, strong.rating, weak.rating, CURVE).points;
  const old = proposeHandicap(t, strong.rating, weak.rating, FLAT).points;
  const strongIndex = suggestedHandicap({ rating: strong.rating }, [], CURVE);
  const weakIndex = suggestedHandicap({ rating: weak.rating }, [], CURVE);
  const options = (selected: number, onChange: (value: number) => void, label: string) => (
    <FormField label={label}>
      <select value={selected} onChange={event => onChange(Number(event.target.value))}>
        {CAST.map((player, index) => <option key={player.short} value={index}>{t("{name}（評分 {rating}）", { name: t(player.name), rating: player.rating })}</option>)}
      </select>
    </FormField>
  );
  return <Surface as="div" className="guide-lab">
    <h3>{t("讓分尺：選擇兩位球友")}</h3>
    <div className="guide-ruler" aria-hidden="true">
      <div className="guide-ruler__track" />
      {CAST.map((player, index) => {
        const mark = index === giver ? " is-giver" : index === receiver ? " is-receiver" : "";
        return <div key={player.short} className={`guide-ruler__player${index % 2 ? " is-low" : ""}${mark}`} style={{ left: `${(indexOf(player.rating) - lo) / (hi - lo) * 100}%` }}>
          <i className="guide-ruler__pin" />
          <span className="guide-ruler__label">{t(player.short)}<br /><b className="guide-num">{suggestedHandicap({ rating: player.rating }, [], CURVE)}</b></span>
        </div>;
      })}
      <div className="guide-ruler__ends"><span>{t("← 指數低：球技較高")}</span><span>{t("指數高：球技較低 →")}</span></div>
    </div>
    <div className="guide-grid guide-grid--selects">
      {options(giver, setGiver, t("讓分的一方（較強）"))}
      {options(receiver, setReceiver, t("收到讓分的一方（較弱）"))}
    </div>
    <div className="guide-tiles" aria-live="polite">
      <StatTile className="guide-tile guide-tile--old" label={t("舊算法：每分固定 25 評分點")} value={same ? "0" : old} />
      <StatTile className="guide-tile guide-tile--new" label={t("現行算法：弱者一分更重")} value={same ? "0" : current} />
      <StatTile className="guide-tile" label={t("兩人的讓分指數")} value={`${strongIndex} / ${weakIndex}`} />
    </div>
    <p className="guide-sum">
      {same
        ? t("請選擇兩位不同的球友。")
        : <>{swapped && <>{t("（已自動以較強者為讓分一方。）")}{" "}</>}
          <Rich text={t("{strong}（指數 **{strongIndex}**）對{weak}（指數 **{weakIndex}**）：{weakIndex} − {strongIndex} ＝ 每局讓 **{points}** 分。", {
            strong: t(strong.name), strongIndex, weak: t(weak.name), weakIndex, points: current,
          })} /></>}
    </p>
  </Surface>;
}

/* ---- page ----------------------------------------------------------------------------------- */
const FAQ = [
  { q: msg("為什麼我贏了，評分反而下降？"), a: msg("評分看的是「比預期好還是差」。如果你是熱門，贏了但贏得很少，仍然低於預期，評分就會略降。") },
  { q: msg("讓分是否絕對公平？"), a: msg("不是。讓分只是按評分估算的起點，而每個人當天狀態不同。為免水平較低的球友要互相讓太多分，本會刻意令他們之間的讓分較少，因此較強的一方略佔優勢。賽果會令評分逐步調整。") },
  { q: msg("只打了幾局，結果準確嗎？"), a: msg("不太準。幾局之內運氣成分很大，所以一場比賽能改變的評分有限。多打幾場，評分才會愈來愈貼近真實水平。") },
  { q: msg("為什麼評分是「點」，讓分是「分」？"), a: msg("「評分點」是評分數字的單位，「分」是檯上實際的得分。第四章說明兩者如何換算。") },
];

export default function EloGuideClient() {
  const t = useT();
  return <main className="elo-guide">
    <header className="guide-top">
      <div className="guide-top__in">
        <BrandLogo compact />
        <LanguageMenu tone="dark" />
      </div>
    </header>

    <section className="guide-hero">
      <div className="guide-hero__in">
        <p className="guide-eyebrow">{t("球會評分指南")}</p>
        <h1>{t("評分，是球技的溫度計。")}</h1>
        <p className="guide-lead">{t("本會用兩個數字，讓實力不同的球友也能打一場勢均力敵的比賽：一個是「評分」，一個是「讓分」。以下用幾個小遊戲，由零開始解釋，毋須任何數學基礎。")}</p>
        <div className="guide-steps">
          <div>
            <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" /><path d="M22 10v12l8 5" /></svg>
            <b>{t("一、預測")}</b><span>{t("賽前，系統按雙方評分，估計各人大約能贏多少局。")}</span>
          </div>
          <div>
            <svg viewBox="0 0 44 44" aria-hidden="true"><rect x="8" y="22" width="11" height="16" rx="2" /><rect x="25" y="9" width="11" height="29" rx="2" /></svg>
            <b>{t("二、對照")}</b><span>{t("賽後，看看實際贏了多少局，是否比預測好。")}</span>
          </div>
          <div>
            <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M8 30l9-9 6 6 13-14M28 13h8v8" /></svg>
            <b>{t("三、修正")}</b><span>{t("比預測好，評分上升；比預測差，評分下降。")}</span>
          </div>
        </div>
      </div>
    </section>

    <Chapter id="guess" tag={t("第一章")} title={t("評分只是一個「預測」")}>
      <div className="guide-wrap"><p><Rich text={t("每位球友由 **1500** 評分開始。數字愈高，代表愈強。兩人評分相差愈大，較強的一方預期能贏的局數愈多。但差距再大，也不會百戰百勝，因為任何人都可能失手。")} /></p></div>
      <div className="guide-wide"><GapBars /></div>
    </Chapter>

    <Chapter id="move" tag={t("第二章")} title={t("贏了，評分不一定上升")}>
      <div className="guide-wrap"><p>{t("評分看的不是勝負，而是「比預期好，還是比預期差」。對手遠比你強，即使輸一兩局，甚至打和，評分也可能上升。對手遠比你弱，贏了但贏得不夠多，評分反而可能下降。拉動下面的滑桿試試。")}</p></div>
      <div className="guide-wide"><Simulator /></div>
      <div className="guide-wrap"><p className="guide-note">{t("局數愈多，結果愈可信，評分的變動也愈大。新加入的球友，頭三場的變動會加大（首場兩倍，第二場一倍半，第三場一倍四分之一），好讓評分盡快接近真實水平。短時間內反覆對同一個人，加減分會逐漸打折。")}</p></div>
    </Chapter>

    <Chapter id="start" tag={t("第三章")} title={t("讓分：先給弱者一點領先")}>
      <div className="guide-wrap"><p>{t("評分相差太遠，比賽很快變成一面倒。「讓分」，就是每一局開始前，先給較弱的一方若干分作領先。強者必須先追回這些分數，才開始真正領先。讓得剛好，雙方各有一半機會。")}</p></div>
      <div className="guide-wide"><Scale /></div>
    </Chapter>

    <Chapter id="worth" tag={t("第四章")} title={t("一分，究竟值多少？")}>
      <div className="guide-wrap">
        <p>{t("同樣是一分，對不同水平的球友，分量並不相同。初學者每次上檯只能打出幾分，落後二十分已經很難追回，所以一分的分量很重。高手一次上檯便能打出二三十分，同樣一分只是小事，分量很輕。")}</p>
        <p><Rich text={t("因此，水平較低的一端，一分約等於 **{low}** 評分點；水平愈高，一分愈輕，最低約等於 **{high}** 評分點。分量重，所需的讓分就少。", { low: LOW_RATE, high: HIGH_RATE })} /></p>
      </div>
      <div className="guide-wide"><Worth /></div>
    </Chapter>

    <Chapter id="index" tag={t("第五章")} title={t("每人一個「讓分指數」")}>
      <div className="guide-wrap"><p><Rich text={t("為免每次臨時計算，每位球友都有一個固定的「讓分指數」。指數愈低，球技愈高；評分 **1500** 的球友，指數定為 **60**。任何兩人之間的讓分，就是兩人指數相減。")} /></p></div>
      <div className="guide-wide"><HandicapRuler /></div>
    </Chapter>

    <section className="guide-chapter" id="faq">
      <div className="guide-wrap">
        <h2>{t("常見疑問")}</h2>
        {FAQ.map(item => <details key={item.q}><summary>{t(item.q)}</summary><div>{t(item.a)}</div></details>)}
      </div>
    </section>

    <section className="guide-chapter" id="sheet">
      <div className="guide-wrap">
        <h2>{t("一頁速查")}</h2>
        <table className="guide-sheet"><tbody>
          <tr><th scope="row">{t("起始評分")}</th><td>{t("所有新球友由 1500 開始。")}</td></tr>
          <tr><th scope="row">{t("預期")}</th><td>{t("評分高 400 點，預期贏約 68% 的局數。")}</td></tr>
          <tr><th scope="row">{t("評分變動")}</th><td>{t("比預期好就升，比預期差就降。")}</td></tr>
          <tr><th scope="row">{t("一分的分量")}</th><td>{t("水平低：約 {low} 評分點。水平高：約 {high} 評分點。", { low: LOW_RATE, high: HIGH_RATE })}</td></tr>
          <tr><th scope="row">{t("讓分指數")}</th><td>{t("評分 1500 為 60，愈低愈強。兩人讓分等於指數之差。")}</td></tr>
        </tbody></table>
        <details>
          <summary>{t("給愛看公式的人")}</summary>
          <div>
            <p>{t("預期贏局比例 = 1 ÷ (1 + 10 的 (−評分差 ÷ 1250) 次方)。評分變動 = 250 × (實際贏局比例 − 預期贏局比例) × 局數可信度，其中局數可信度 = 局數 ÷ (局數 + 5)。")}</p>
            <p className="guide-formula">expected = 1 / (1 + 10^(-gap / 1250))<br />change = 250 × (actual − expected) × n / (n + 5)</p>
            <p>{t("當讓分遠超公平水平時，系統還會額外加重結果的權重。")}</p>
          </div>
        </details>
      </div>
    </section>

    <footer className="guide-footer">
      <div className="guide-wrap">
        <p>{t("本頁數字依據球會評分模型第 {version} 版。這是一份說明，並非比賽規則；實際讓分以球會系統顯示的為準。", { version: HANDICAP_MODEL_VERSION })}</p>
        <ButtonLink variant="secondary" href="/">{t("返回排行榜")}</ButtonLink>
      </div>
    </footer>
  </main>;
}
