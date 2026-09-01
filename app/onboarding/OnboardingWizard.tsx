"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AVATAR_COLOURS, DEFAULT_AVATAR, avatarHex } from "../avatar-colours";
import { checkAvatar, deriveInitials, MAX_AVATAR_CHARS } from "../api/account/validate";
import { Button } from "../components/ui/Primitives";

const questionOne = [
  ["700", "打唔中白波／白波打唔中目標波"], ["900", "大部分情況都可以打中目標波"],
  ["1100", "可以穩定打入一個波"], ["1300", "可以穩定連續打入一組（兩個）波"],
  ["1500", "可以打到多杆（15+）"], ["1700", "可以打到多杆（30+）"], ["1900", "可以打到50+"],
] as const;
const questionTwo = [["2000", "32強或以下"], ["2100", "16強"], ["2200", "8強"], ["2300", "4強或以上"]] as const;

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
  const [step, setStep] = useState<"profile" | "rating">("profile");
  const [finalRating, setFinalRating] = useState<number | null>(null);

  if (finalRating !== null) {
    return <main className="onboarding-page"><section className="onboarding-confirm" aria-live="polite">
      <span className="onboarding-mark">SCAA</span>
      <p className="onboarding-kicker">歡迎加入，{member.displayName}</p>
      <h1>你的初始評級為：{finalRating}</h1>
      <p>評級已儲存。由第一局開始，讓每一局都推動進步。</p>
      <Link className="onboarding-home-link" href="/">進入排行榜</Link>
    </section></main>;
  }

  return <main className="onboarding-page"><section className="onboarding-card">
    <span className="onboarding-mark">SCAA</span>
    <p className="onboarding-kicker">{reminder ? "請讓我們更了解你" : "新會員設定"}</p>
    <ol className="onboarding-steps" aria-label="設定步驟">
      <li className={step === "profile" ? "is-current" : "is-done"}><span>1</span>個人資料</li>
      <li className={step === "rating" ? "is-current" : undefined}><span>2</span>初始評級</li>
    </ol>
    {step === "profile"
      ? <ProfileStep member={member} onDone={() => setStep("rating")} />
      : <RatingStep displayName={member.displayName} onDone={setFinalRating} />}
  </section></main>;
}

function ProfileStep({ member, onDone }: { member: Member; onDone: () => void }) {
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
      if (problem) return setAvatarError(problem === "avatar-large" ? "圖片過大，請選擇較小的圖片。" : "僅支援 PNG、JPEG 或 WebP 圖片。");
      setAvatarError("");
      setAvatar(dataUri);
    } catch {
      setAvatarError("僅支援 PNG、JPEG 或 WebP 圖片。");
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
    if (!response.ok) return setError("未能儲存資料，請稍後再試。");
    onDone();
  }

  return <>
    <h1>設定你的個人形象</h1>
    <p className="onboarding-intro">頭像、縮寫同顏色會出現喺排行榜、球員卡及對戰紀錄。之後隨時可以喺「設定」中更改。</p>

    <div className="avatar-picker">
      {avatar
        // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
        ? <img className="member-avatar" src={avatar} alt="" />
        : <div className="member-avatar" style={{ background: avatarHex(iconColour) }}>{shownInitials}</div>}
      <div className="avatar-picker-actions">
        <Button variant="quiet" onClick={() => fileInput.current?.click()}>上傳圖片</Button>
        {avatar && <Button variant="quiet" onClick={() => setAvatar(null)}>移除</Button>}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={event => { void pickAvatar(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {avatarError && <small className="field-error">{avatarError}</small>}
    </div>

    <label className="onboarding-field">頭像縮寫
      <input value={initials} maxLength={3} placeholder={autoInitials} onChange={event => setInitials(event.target.value.toUpperCase())} />
      <small className="field-hint">留空則使用球員姓名自動產生。</small>
    </label>

    <div className="colour-field" role="group" aria-labelledby="onboarding-colour-label">
      <span className="colour-field-label" id="onboarding-colour-label">圖示顏色</span>
      <div className="colour-grid" role="radiogroup" aria-label="圖示顏色">
        {AVATAR_COLOURS.map(option => <button key={option.id} type="button" role="radio"
          aria-checked={iconColour === option.id} aria-label={option.name} title={option.name}
          className={`colour-swatch${iconColour === option.id ? " active" : ""}`}
          style={{ background: option.hex }} onClick={() => setIconColour(option.id)} />)}
      </div>
    </div>

    {error && <p className="onboarding-error" role="alert">{error}</p>}
    <Button className="onboarding-submit" onClick={submit} disabled={saving}>{saving ? "儲存中…" : "繼續"}</Button>
  </>;
}

function RatingStep({ displayName, onDone }: { displayName: string; onDone: (rating: number) => void }) {
  const [q1, setQ1] = useState<string | null>(null);
  const [q2, setQ2] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function chooseQ1(value: string) {
    setQ1(value);
    if (value !== "1900") setQ2(null);
    setError(value === "700" ? "✕ 需要能夠用白波擊中目標波先可以開帳戶。" : "");
  }

  async function submit() {
    if (!q1) return setError("請完成第一條問題。");
    if (q1 === "700") return setError("✕ 需要能夠用白波擊中目標波先可以開帳戶。");
    if (q1 === "1900" && !q2) return setError("請完成第二條問題。");
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q1, q2 }) });
    const result = await response.json() as { finalRating?: number; error?: string };
    setSubmitting(false);
    if (!response.ok) return setError(result.error ?? "未能儲存評級，請稍後再試。");
    if (result.finalRating !== undefined) onDone(result.finalRating);
  }

  return <>
    <h1>了解你嘅打波水平</h1>
    <p className="onboarding-intro">{displayName}，答幾條問題，幫你設定一個更貼近實力嘅初始評級。</p>
    <div className="onboarding-question">
      <h2>你認為自己現在的打波水平大約是？</h2>
      <div className="onboarding-options">{questionOne.map(([value, label]) => <Button key={value} className={`onboarding-option${q1 === value ? " is-selected" : ""}`} aria-pressed={q1 === value} onClick={() => chooseQ1(value)}><span>{label}</span></Button>)}</div>
    </div>
    <div className={`onboarding-secondary${q1 === "1900" ? " is-visible" : ""}`} aria-hidden={q1 !== "1900"}>
      <div className="onboarding-question">
        <h2>你喺香港公開賽（Hong Kong Open）嘅最好成績係？</h2>
        <div className="onboarding-options onboarding-options-compact">{questionTwo.map(([value, label]) => <Button key={value} className={`onboarding-option${q2 === value ? " is-selected" : ""}`} aria-pressed={q2 === value} tabIndex={q1 === "1900" ? 0 : -1} onClick={() => setQ2(value)}><span>{label}</span></Button>)}</div>
      </div>
    </div>
    {error && <p className="onboarding-error" role="alert">{error}</p>}
    <Button className="onboarding-submit" onClick={submit} disabled={submitting || q1 === "700"}>{submitting ? "儲存中…" : "提交"}</Button>
  </>;
}
