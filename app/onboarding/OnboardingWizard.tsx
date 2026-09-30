"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AVATAR_COLOURS, DEFAULT_AVATAR, avatarHex } from "../avatar-colours";
import { checkAvatar, deriveInitials, MAX_AVATAR_CHARS } from "../api/account/validate";
import { Button } from "../components/ui/Primitives";
import { useT } from "../components/I18nProvider";
import { msg } from "../../lib/i18n/translate";

const questionOne = [
  ["450", msg("未能穩定以母球擊中目標球")], ["550", msg("大部分情況下能擊中目標球")],
  ["1000", msg("能穩定打入單一球")], ["1200", msg("能穩定連續打入一組（兩球）")],
  ["1500", msg("能打出 15 分以上的單桿（15+）")], ["1700", msg("能打出 30 分以上的單桿（30+）")], ["1900", msg("能打出 50 分以上的單桿（50+）")],
  ["2100", msg("能打出 70 分以上的單桿（70+）")], ["2400", msg("能打出 90 分以上的單桿（90+）")],
  ["2800", msg("曾打出一次破百單桿（Century）")], ["3300", msg("曾打出多於一次破百單桿（Centuries）")],
] as const;

/** Where a brand-new member goes next. Ending onboarding on a bare "go to rankings" left people
    looking at a table with no idea what to do first; these are the two actions that make the app theirs. */
const NEXT_STEPS = [
  { href: "/?start=record", title: msg("記錄第一場比賽"), body: msg("登記局分後，雙方評分即會更新。") },
  { href: "/?tab=availability", title: msg("登記有空時段"), body: msg("讓系統為你配對合適的對手。") },
] as const;

const AVATAR_SIZE = 160;

function readAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("avatar-format"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("avatar-format"));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = AVATAR_SIZE;
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("avatar-format"));
        const side = Math.min(image.width, image.height);
        context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

type Member = {
  displayName: string; username: string; email: string; playerName?: string;
  avatar?: string | null; initials?: string | null; iconColour?: string | null;
};

export default function OnboardingWizard({ member, reminder = false }: { member: Member; reminder?: boolean }) {
  const t = useT();
  const [step, setStep] = useState<"profile" | "rating">("profile");
  const [finalRating, setFinalRating] = useState<number | null>(null);

  if (finalRating !== null) {
    return <main className="onboarding-page"><section className="onboarding-confirm" aria-live="polite">
      <span className="onboarding-mark">SCAA</span>
      <p className="onboarding-kicker">{t("歡迎加入，{displayName}", {displayName: member.displayName})}</p>
      <h1>{t("你的初始評級為：{finalRating}", {finalRating})}</h1>
      <p>{t("評級已儲存。以下是開始使用的建議步驟。")}</p>
      <ul className="onboarding-next" aria-label={t("下一步")}>
        {NEXT_STEPS.map(item=><li key={item.href}><Link href={item.href}>
          <span><b>{t(item.title)}</b><small>{t(item.body)}</small></span>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 6 6 6-6 6"/></svg>
        </Link></li>)}
      </ul>
      <Link className="onboarding-home-link" href="/">{t("查看排行榜")}</Link>
    </section></main>;
  }

  return <main className="onboarding-page"><section className="onboarding-card">
    <span className="onboarding-mark">SCAA</span>
    <p className="onboarding-kicker">{reminder ? t("請讓我們更了解你") : t("新會員設定")}</p>
    <ol className="onboarding-steps" aria-label={t("設定步驟")}>
      <li className={step === "profile" ? "is-current" : "is-done"}><span>1</span>{t("個人資料")}</li>
      <li className={step === "rating" ? "is-current" : undefined}><span>2</span>{t("初始評級")}</li>
    </ol>
    {step === "profile"
      ? <ProfileStep member={member} onDone={() => setStep("rating")} />
      : <RatingStep displayName={member.displayName} onBack={() => setStep("profile")} onDone={setFinalRating} />}
  </section></main>;
}

function ProfileStep({ member, onDone }: { member: Member; onDone: () => void }) {
  const t = useT();
  const [avatar, setAvatar] = useState<string | null>(member.avatar ?? null);
  const [initials, setInitials] = useState(member.initials ?? "");
  const [iconColour, setIconColour] = useState(member.iconColour || DEFAULT_AVATAR);
  const [avatarError, setAvatarError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const autoInitials = deriveInitials(member.playerName ?? member.displayName);
  const shownInitials = initials.trim().toUpperCase() || autoInitials;

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const dataUri = await readAvatar(file);
      const problem = checkAvatar(dataUri) ?? (dataUri.length > MAX_AVATAR_CHARS ? "avatar-large" : null);
      if (problem) return setAvatarError(problem === "avatar-large" ? t("圖片過大，請選擇較小的圖片。") : t("僅支援 PNG、JPEG 或 WebP 圖片。"));
      setAvatarError("");
      setAvatar(dataUri);
    } catch {
      setAvatarError(t("僅支援 PNG、JPEG 或 WebP 圖片。"));
    }
  }

  async function submit() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: member.username, email: member.email, displayName: member.displayName,
        avatar, initials: initials.trim().toUpperCase() || autoInitials, iconColour,
      }),
    });
    setSaving(false);
    if (!response.ok) return setError(t("未能儲存資料，請稍後再試。"));
    onDone();
  }

  return <>
    <h1>{t("設定你的個人形象")}</h1>
    <p className="onboarding-intro">{t("頭像、縮寫同顏色會出現喺排行榜、球員卡及對戰紀錄。之後隨時可以喺「設定」中更改。")}</p>

    <div className="avatar-picker">
      {avatar
        // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
        ? <img className="member-avatar" src={avatar} alt="" />
        : <div className="member-avatar" style={{ background: avatarHex(iconColour) }}>{shownInitials}</div>}
      <div className="avatar-picker-actions">
        <Button variant="quiet" onClick={() => fileInput.current?.click()}>{t("上傳圖片")}</Button>
        {avatar && <Button variant="quiet" onClick={() => setAvatar(null)}>{t("移除")}</Button>}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={event => { void pickAvatar(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {avatarError && <small className="field-error">{avatarError}</small>}
    </div>

    <label className="onboarding-field">{t("頭像縮寫")}<input value={initials} maxLength={3} placeholder={autoInitials} onChange={event => setInitials(event.target.value.toUpperCase())} />
      <small className="field-hint">{t("留空則使用球員姓名自動產生。")}</small>
    </label>

    <div className="colour-field" role="group" aria-labelledby="onboarding-colour-label">
      <span className="colour-field-label" id="onboarding-colour-label">{t("圖示顏色")}</span>
      <div className="colour-grid" role="radiogroup" aria-label={t("圖示顏色")}>
        {AVATAR_COLOURS.map(option => <button key={option.id} type="button" role="radio"
          aria-checked={iconColour === option.id} aria-label={t(option.name)} title={t(option.name)}
          className={`colour-swatch${iconColour === option.id ? " active" : ""}`}
          style={{ background: option.hex }} onClick={() => setIconColour(option.id)} />)}
      </div>
    </div>

    {error && <p className="onboarding-error" role="alert">{error}</p>}
    <Button className="onboarding-submit" onClick={submit} disabled={saving}>{saving ? t("儲存中…") : t("繼續")}</Button>
  </>;
}

function RatingStep({ displayName, onBack, onDone }: { displayName: string; onBack: () => void; onDone: (rating: number) => void }) {
  const t = useT();
  const [q1, setQ1] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function chooseQ1(value: string) {
    setQ1(value);
    setError("");
  }

  async function submit() {
    if (!q1) return setError(t("請完成第一條問題。"));
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q1 }) });
    const result = await response.json() as { finalRating?: number; error?: string };
    setSubmitting(false);
    if (!response.ok) return setError(result.error ?? t("未能儲存評級，請稍後再試。"));
    if (result.finalRating !== undefined) onDone(result.finalRating);
  }

  return <>
    <h1>{t("了解你的球技水平")}</h1>
    <p className="onboarding-intro">{t("{displayName}，請回答以下問題，以便為你設定更貼近實力的初始評級。", {displayName})}</p>
    <div className="onboarding-question">
      <h2>{t("你認為自己目前的球技水平大約屬於哪一級？")}</h2>
      <div className="onboarding-options">{questionOne.map(([value, label]) => <Button key={value} className={`onboarding-option${q1 === value ? " is-selected" : ""}`} aria-pressed={q1 === value} onClick={() => chooseQ1(value)}><span>{t(label)}</span></Button>)}</div>
    </div>
    {error && <p className="onboarding-error" role="alert">{error}</p>}
    <div className="onboarding-actions">
      <Button variant="secondary" type="button" onClick={onBack}>{t("返回上一步")}</Button>
      <Button className="onboarding-submit" onClick={submit} disabled={submitting}>{submitting ? t("儲存中…") : t("提交")}</Button>
    </div>
  </>;
}
