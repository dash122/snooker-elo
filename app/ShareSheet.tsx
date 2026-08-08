"use client";

import { useMemo, useState } from "react";
import { avatarHex } from "./avatar-colours";
import { shareStory, shareText, svgDataUrl } from "./story-image";
import { storySvg, type StoryCard } from "../lib/story-card";
import { storyCaption } from "../lib/match-share";

/** The one place a member shares from.
 *
 *  Two destinations, because they are two different acts. WhatsApp is *telling* the group — it goes
 *  to people who already know you, it wants text, and the payoff is a link that opens the app.
 *  Instagram is *showing* everyone — it goes to people who have never heard of the club, it wants a
 *  picture, and the payoff is that the club's name and address sit inside the image where a story
 *  viewer cannot help but read them. Giving both the same button would serve neither.
 *
 *  The story card is shown, not described. It is the product here, and a member deciding whether to
 *  post something to their own Instagram is entitled to see exactly what it looks like first. */
export default function ShareSheet({ card, message, url, title }: { card: StoryCard; message: string; url: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const svg = useMemo(() => storySvg(card, avatarHex), [card]);

  const toStory = async () => {
    setBusy(true);
    setNote("");
    const outcome = await shareStory(svg, {
      filename: `scaa-snooker-${card.kind}.png`,
      title,
      text: storyCaption(url),
    });
    setBusy(false);
    if (outcome === "downloaded") setNote("已儲存圖片。喺手機開 Instagram → 限時動態 → 揀呢張相就發到。");
    else if (outcome === "failed") setNote("圖片整唔到，請再試一次。");
  };

  const toWhatsApp = () => { void shareText(message, title); };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNote("已複製連結。");
    } catch { setNote("複製唔到，請長按連結手動複製。"); }
  };

  return <div className="share-sheet">
    <p className="kicker">分享</p>
    <h2>{card.kind === "result" ? "分享今場賽果" : "分享我嘅紀錄"}</h2>
    <p className="sub">WhatsApp 分享連結，Instagram 分享限時動態圖。</p>

    <div className="story-preview">
      {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI, no loader involved */}
      <img src={svgDataUrl(svg)} alt="Instagram 限時動態預覽" width={1080} height={1920} />
    </div>

    <div className="share-actions">
      <button type="button" className="share-btn whatsapp" onClick={toWhatsApp}>
        <ShareGlyph kind="whatsapp" />
        <span><b>WhatsApp 分享</b><small>連結會顯示賽果預覽</small></span>
      </button>
      <button type="button" className="share-btn instagram" disabled={busy} onClick={() => void toStory()}>
        <ShareGlyph kind="instagram" />
        <span><b>{busy ? "整緊圖…" : "Instagram 限時動態"}</b><small>1080×1920 · 直接出 Story</small></span>
      </button>
      <button type="button" className="share-btn plain" onClick={() => void copy()}>
        <ShareGlyph kind="link" />
        <span><b>複製連結</b><small>{url.replace(/^https?:\/\//, "")}</small></span>
      </button>
    </div>

    {note && <p className="share-sheet-note" role="status">{note}</p>}
    <p className="share-sheet-foot">連結唔使登入都睇到，收到嘅人一撳就見到賽果。</p>
  </div>;
}

/* Drawn rather than lettered: the two brands' own marks are theirs, and a plain glyph in the app's
   own hand says "this goes to WhatsApp" without borrowing anyone's logo. */
function ShareGlyph({ kind }: { kind: "whatsapp" | "instagram" | "link" }) {
  if (kind === "whatsapp") return <i className="share-glyph" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5.2A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M8.6 8.4c.3-.6.6-.6 1-.6h.6c.2 0 .4.1.6.6l.6 1.4c.1.3 0 .5-.2.7l-.4.4c-.2.2-.2.4-.1.6a5.6 5.6 0 0 0 2.6 2.3c.3.1.5 0 .6-.1l.5-.6c.2-.2.4-.2.6-.1l1.4.7c.3.1.4.3.4.6a1.8 1.8 0 0 1-1.8 1.6c-1 0-2.9-.6-4.6-2.3s-2.4-3.6-2.4-4.6c0-.4.2-.9.6-1.6Z" />
    </svg>
  </i>;
  if (kind === "instagram") return <i className="share-glyph" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" /><circle cx="17.1" cy="6.9" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  </i>;
  return <i className="share-glyph" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </svg>
  </i>;
}
