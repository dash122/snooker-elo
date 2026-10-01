"use client";
import Link from "next/link";
import { CupMark, PlayerBadge } from "../../UiBits";
import ShareSheet from "../../ShareSheet";
import { shareScoreline, type MatchShareState } from "../../../lib/match-share";
import type { ResultStoryCard } from "../../../lib/story-card";
import { useT } from "../../components/I18nProvider";
import { msg } from "../../../lib/i18n/translate";

const OCCASION: Record<MatchShareState["kind"], string> = { cup: msg("盃賽"), fun: msg("潮拍 2v2"), rated: msg("球會對局") };

/** The page behind a shared result.
 *
 *  Readable by anyone the link reaches — the club's WhatsApp group included — before they have an
 *  account, because a result that demands a login to read is not something anyone forwards. Signing
 *  in is asked for at the one moment it is actually worth something: recording your own next game.
 *
 *  It carries the full share sheet rather than a single "share" button, and that is the point. The
 *  reader of a forwarded result is exactly the person most likely to forward it again — or to post
 *  it to a story, if they are in it — so the second hop is one tap from where the first one landed. */
export default function MatchShareView({ share, card, message, url, signedIn }: {
  share: MatchShareState | null; card: ResultStoryCard | null; message: string; url: string; signedIn: boolean;
}) {
  const t = useT();
  if (!share || !card) return <main className="share-page"><div className="share-card">
    <p className="share-kicker">{t("Snooker ELO · 賽果")}</p>
    <h1>{t("搵唔到呢場比賽")}</h1>
    <p className="share-note">{t("連結可能已經失效，或者呢場賽事已被刪除。")}</p>
    <Link className="primary full share-cta" href="/">{t("開啟 Snooker ELO")}</Link>
  </div></main>;

  const sides = [share.left, share.right];
  const occasion = share.cup ? share.cup.name : t(OCCASION[share.kind]);

  return <main className="cup-share-page match-share-page">
    <div className="match-share-hero">
      <p className="share-kicker">Snooker ELO · {t(OCCASION[share.kind])}</p>
      {/* The round rides above the cup's name in a hairline ribbon, the same shape the story card
          uses, so the page and the image a reader may have arrived from read as one thing. */}
      {share.cup?.round && <p className="cup-ribbon"><span><CupMark />{share.cup.round}</span></p>}
      <h1>{occasion}</h1>
      <p className="match-share-date"><time dateTime={share.playedOn}>{share.playedOn}</time></p>
    </div>

    <section className="match-share-board" aria-label={t("賽果 {v}", {v: shareScoreline(share)})}>
      {sides.map((side, index) => <div className={`match-share-side${side.won && !share.drawn ? " won" : ""}`} key={index}>
        <PlayerBadge player={{ short: side.short, colour: side.colour, avatar: side.avatar }} />
        <div className="match-share-who">
          <b>{side.name}</b>
          {side.members.length > 0 && <small>{side.members.join(t("、"))}</small>}
        </div>
        <em>{side.score}</em>
      </div>)}
      <span className="match-share-vs">{share.drawn ? t("打成平手") : "VS"}</span>
    </section>

    <div className="share-chips match-share-chips">
      {share.handicap && <span className="share-chip">{share.handicap}</span>}
      {share.eloDelta > 0
        ? <span className="share-chip gold">ELO ±{share.eloDelta}</span>
        : <span className="share-chip">{t("友誼賽 · 不計 ELO")}</span>}
      {share.breaks[0] && <span className="share-chip gold">{t("單桿 {value} · {name}", {value: share.breaks[0].value, name: share.breaks[0].name})}</span>}
    </div>

    <div className="cup-share-actions">
      <Link className="cup-btn primary" href={signedIn ? "/?tab=matches" : "/login?mode=signup"}>
        {signedIn ? t("開啟 App 睇全部賽果") : t("註冊記錄你自己嘅賽果")}
      </Link>
    </div>

    <section className="match-share-resend">
      <ShareSheet card={card} message={message} url={url} title={t("Snooker ELO 賽果")} />
    </section>

    <p className="share-foot">{t("未係會員都睇到呢頁 — Snooker ELO 嘅賽果連結。")}</p>
  </main>;
}
