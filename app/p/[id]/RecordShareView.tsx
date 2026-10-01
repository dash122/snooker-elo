"use client";
import Link from "next/link";
import { CupMark, PlayerBadge } from "../../UiBits";
import ShareSheet from "../../ShareSheet";
import { honourText, type RecordShareState } from "../../../lib/match-share";
import type { RecordStoryCard } from "../../../lib/story-card";
import { useT } from "../../components/I18nProvider";

/** The page behind a shared player record.
 *
 *  The other half of the share story. On a week with no game worth posting, a rating and a rank are
 *  still worth showing — and this is the page a stranger lands on when a member's story card sends
 *  them somewhere. So the call to action is the club's, not the app's: the visitor is invited to
 *  join and play this person, which is the only thing they could possibly want from here. */
export default function RecordShareView({ share, card, message, url, signedIn }: {
  share: RecordShareState | null; card: RecordStoryCard | null; message: string; url: string; signedIn: boolean;
}) {
  const t = useT();
  if (!share || !card) return <main className="share-page"><div className="share-card">
    <p className="share-kicker">{t("Snooker ELO · 球員")}</p>
    <h1>{t("搵唔到呢位球員")}</h1>
    <p className="share-note">{t("連結可能已經失效，或者球員紀錄已被移除。")}</p>
    <Link className="primary full share-cta" href="/">{t("開啟 Snooker ELO")}</Link>
  </div></main>;

  const honour = honourText(t, share.honours);
  const stats = [
    { label: t("場數"), value: String(share.played) },
    { label: t("勝／負／和"), value: `${share.wins}/${share.losses}/${share.draws}` },
    { label: t("局數勝率"), value: `${Math.round(share.frameRate * 100)}%` },
    { label: t("最高單桿"), value: share.highestBreak > 0 ? String(share.highestBreak) : "—" },
  ];

  return <main className="cup-share-page record-share-page">
    <div className="record-share-hero">
      {/* Above the name, not beside it: a cup is the first thing a stranger arriving from a story
          should be told about this person, and the same ribbon the result page uses says it. */}
      {honour && <p className="cup-ribbon"><span><CupMark />{honour}</span></p>}
      <PlayerBadge player={{ short: share.short, colour: share.colour, avatar: share.avatar }} />
      <h1>{share.name}</h1>
      <div className="share-chips record-share-chips">
        {share.rank > 0 && <span className="share-chip gold">{t("球會排名 #{rank}", {rank: share.rank})}</span>}
        <span className="share-chip">{share.provisional ? t("臨時 ELO") : t("正式 ELO")}</span>
        {share.swing !== 0 && <span className="share-chip">{t("近 10 日")} {share.swing > 0 ? "+" : "−"}{Math.abs(share.swing)}</span>}
      </div>
      <p className="record-share-elo"><small>{t("目前 ELO")}</small><b>{share.rating}</b></p>
    </div>

    <section className="record-share-stats">
      {stats.map(stat => <div key={stat.label}><small>{stat.label}</small><b>{stat.value}</b></div>)}
    </section>

    {share.form.length > 0 && <section className="record-share-form">
      <small>{t("近期 {form} 場", {form: share.form.length})}</small>
      {/* `.form`, not the profile hero's `.profile-form-dots`: those dots are drawn white-on-
          translucent for the dark hero, and a draw would be all but invisible on this light page. */}
      <span className="form">{share.form.map((result, index) =>
        <i key={`${result}-${index}`} className={result.toLowerCase()}>{result}</i>)}</span>
    </section>}

    <div className="cup-share-actions">
      <Link className="cup-btn primary" href={signedIn ? "/?tab=availability" : "/login?mode=signup"}>
        {signedIn ? t("約佢開波") : t("註冊約 {name} 開波", {name: share.name})}
      </Link>
    </div>

    <section className="match-share-resend">
      <ShareSheet card={card} message={message} url={url} title={`${share.name} · Snooker ELO`} />
    </section>

    <p className="share-foot">{t("未係會員都睇到呢頁 — Snooker ELO 嘅球員紀錄。")}</p>
  </main>;
}
