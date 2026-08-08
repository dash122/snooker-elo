"use client";

import { useState } from "react";
import { avatarHex } from "./avatar-colours";
import { ShareGlyph } from "./ShareSheet";
import { shareStory, shareText } from "./story-image";
import { cupShareCta, cupShareMessage, type CupShareState } from "../lib/cup-share";
import { cupStoryCard, cupStorySvg, type StoryBracketRound, type StoryPerson } from "../lib/story-card";

/** The two ways a cup leaves the app, side by side.
 *
 *  One component for both surfaces — the cup tab and the public `/c/[id]` page — because the reader
 *  of a shared link is the club's next recruiter and there is no reason they should get a weaker
 *  version of the buttons the member who sent it had.
 *
 *  ## The Instagram link, and why there is no tappable one
 *
 *  There is no way for a web app to attach a link sticker to an Instagram story. `navigator.share`
 *  hands Instagram an image file and nothing else; the `instagram-stories://share` intent that can
 *  carry a `contentURL` is only honoured for a registered native app with a Facebook App ID, and not
 *  from a browser at all. Asking Instagram nicely is not one of the options.
 *
 *  So the link is handled the only way that actually works: it is drawn on the card as large as the
 *  design allows, and the moment the card is shared the URL goes onto the clipboard, so the poster's
 *  next action in Instagram — add link sticker, paste — is one tap and no typing. The note says so,
 *  because a member who does not know the clipboard is loaded will not think to paste. */
export default function CupShareButtons({ name, state, url, entrants, champion, bracket = [], tone = "ghost" }: {
  name: string;
  state: CupShareState;
  url: string;
  entrants: StoryPerson[];
  champion: StoryPerson | null;
  /** The whole tree, drawn on the story once the cup is finished. Ignored before then. */
  bracket?: StoryBracketRound[];
  /** The WhatsApp button's weight. The cup page leads with it; the app's row already has a primary. */
  tone?: "primary" | "ghost";
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const cta = cupShareCta(state);
  const message = cupShareMessage(name, state, url);

  const toWhatsApp = () => { void shareText(message, name); };

  const toStory = async () => {
    setBusy(true);
    setNote("");
    /* Copied before the sheet opens, not after: on iOS the share sheet takes the page out of focus,
       and a clipboard write from a backgrounded document is rejected. */
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* no clipboard */ }
    const svg = cupStorySvg(cupStoryCard(name, state, url, entrants, champion, bracket), avatarHex);
    const outcome = await shareStory(svg, { filename: "scaa-cup.png", title: name, text: `${name}\n${url}` });
    setBusy(false);
    if (outcome === "failed") { setNote("圖片整唔到，請再試一次。"); return; }
    const paste = copied ? "連結已經複製" : `連結：${url}`;
    setNote(outcome === "downloaded"
      ? `已儲存圖片。喺手機開 IG → 限時動態 → 揀呢張相，再加「連結」貼紙貼上（${paste}）。`
      : `揀咗 Instagram 之後，記得加「連結」貼紙貼上，人哋先撳得入嚟報名（${paste}）。`);
  };

  return <>
    <div className="cup-share-buttons">
      <button type="button" className={`cup-btn ${tone} wa-btn`} onClick={toWhatsApp} aria-label={cta.label}>
        <ShareGlyph kind="whatsapp" /><span>{cta.label}</span>
      </button>
      <button type="button" className="cup-btn ghost ig-btn" disabled={busy} onClick={() => void toStory()}>
        <ShareGlyph kind="instagram" />
        <span>{busy ? "整緊圖…" : state.status === "signup" ? "IG 限時動態招兵" : "IG 限時動態"}</span>
      </button>
    </div>
    {note && <p className="cup-share-note" role="status">{note}</p>}
  </>;
}
