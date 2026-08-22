"use client";

import { useRef, useState } from "react";
import { AVATAR_COLOURS, DEFAULT_AVATAR, avatarHex } from "../avatar-colours";
import { checkAvatar, checkDisplayName, checkEmail, checkInitials, checkPassword, checkUsername, deriveInitials, MAX_AVATAR_CHARS } from "../api/account/validate";
import { Button } from "../components/ui/Primitives";

const zh = {
  email: "電郵",
  editProfile: "編輯資料", profileHint: "更改使用者名稱或電郵需輸入目前密碼。",
  avatar: "頭像", upload: "上傳圖片", remove: "移除",
  initials: "頭像縮寫", initialsHint: "留空則使用球員姓名自動產生。",
  colour: "圖示顏色", badgePreview: "球員圖示預覽",
  badgeHint: "縮寫與顏色會即時套用到排行榜、球員卡及對戰紀錄；上傳圖片後，圖片會取代縮寫顯示。",
  displayName: "顯示名稱", username: "使用者名稱",
  current: "目前密碼", save: "儲存變更", saving: "儲存中…", saved: "已儲存。", cancel: "取消",
  changePassword: "變更密碼", newPassword: "新密碼", confirmPassword: "確認新密碼", updatePassword: "更新密碼",
  passwordSaved: "密碼已更新。",
  dangerTrigger: "停用帳戶", dangerHint: "停用後將立即登出，且無法再登入，需由管理員重新啟用。球員成績不會被刪除。",
  confirmLabel: "輸入使用者名稱以確認", deactivate: "確認停用",
};

const errors: Record<string, string> = {
  "username-format": "使用者名稱需 3-24 個字元，僅限英文、數字、. _ -。",
  "email-format": "電郵格式不正確。",
  "display-name-format": "顯示名稱需 1-40 個字元。",
  "password-short": "密碼至少需 6 個字元。",
  "password-required": "請輸入目前密碼。",
  "password-wrong": "目前密碼不正確。",
  "password-same": "新密碼不能與目前密碼相同。",
  "password-mismatch": "兩次輸入的新密碼不一致。",
  "username-taken": "該使用者名稱已被使用。",
  "email-taken": "該電郵已被使用。",
  "avatar-large": "圖片過大，請選擇較小的圖片。",
  "avatar-format": "僅支援 PNG、JPEG 或 WebP 圖片。",
  "initials-format": "縮寫需為 1-3 個英文字母。",
  "colour-unknown": "請從色板中選擇顏色。",
  "confirm-mismatch": "輸入的使用者名稱不符。",
  "last-admin": "您是唯一的管理員，無法停用帳戶。",
  unknown: "操作失敗，請稍後再試。",
};

const message = (code: string) => errors[code] ?? errors.unknown;

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; field?: string };
  if (response.ok && data.ok) return null;
  return { error: data.error ?? "unknown", field: data.field };
}

const AVATAR_SIZE = 160;

// Shrink whatever the member picked to a small square data URI so it fits in
// the members table without needing separate blob storage.
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

type Member = { username: string; email: string; displayName: string; avatar?: string | null; initials?: string | null; iconColour?: string | null; playerName?: string };

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className={error ? "field-invalid" : undefined}>
    {label}{children}
    {error && <small className="field-error">{message(error)}</small>}
  </label>;
}

export default function AccountForms({ member }: { member: Member }) {
  return <>
    <ProfileSection member={member} />
    <PasswordSection />
    <DangerZone username={member.username} />
  </>;
}

// Read-only by default — most visits are to check a stat, not to edit
// anything. Editing is an explicit second step.
function ProfileSection({ member }: { member: Member }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return <section className="account-summary-row">
      <span className="account-summary-email">{member.email}</span>
      <Button variant="quiet" className="link-trigger" onClick={() => setEditing(true)}>{zh.editProfile}</Button>
    </section>;
  }
  return <ProfileForm member={member} onDone={() => setEditing(false)} />;
}

function ProfileForm({ member, onDone }: { member: Member; onDone: () => void }) {
  const [username, setUsername] = useState(member.username);
  const [email, setEmail] = useState(member.email);
  const [displayName, setDisplayName] = useState(member.displayName);
  const [avatar, setAvatar] = useState<string | null>(member.avatar ?? null);
  const [initials, setInitials] = useState(member.initials ?? "");
  const [iconColour, setIconColour] = useState(member.iconColour || DEFAULT_AVATAR);
  const [currentPassword, setCurrentPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const fileInput = useRef<HTMLInputElement>(null);

  const identityChanged = username.trim().toLowerCase() !== member.username || email.trim().toLowerCase() !== member.email;

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const dataUri = await readAvatar(file);
      const problem = checkAvatar(dataUri) ?? (dataUri.length > MAX_AVATAR_CHARS ? "avatar-large" : null);
      if (problem) return setFieldErrors(previous => ({ ...previous, avatar: problem }));
      setFieldErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== "avatar")));
      setAvatar(dataUri);
      setStatus("idle");
    } catch {
      setFieldErrors(previous => ({ ...previous, avatar: "avatar-format" }));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const username_ = checkUsername(username); if (username_) found.username = username_;
    const email_ = checkEmail(email); if (email_) found.email = email_;
    const displayName_ = checkDisplayName(displayName); if (displayName_) found.displayName = displayName_;
    const trimmedInitials = initials.trim().toUpperCase();
    const initials_ = checkInitials(trimmedInitials || null); if (initials_) found.initials = initials_;
    if (identityChanged && !currentPassword) found.currentPassword = "password-required";
    setFieldErrors(found);
    if (Object.keys(found).length) return;

    setStatus("saving");
    const failure = await post("/api/account/profile", {
      username, email, displayName, avatar, initials: trimmedInitials || autoInitials, iconColour, currentPassword: currentPassword || undefined,
    });
    if (failure) {
      setStatus("idle");
      setFieldErrors({ [failure.field ?? "form"]: failure.error });
      return;
    }
    setCurrentPassword("");
    setStatus("saved");
    // Pick up the new name/avatar/initials in the header and elsewhere.
    location.reload();
  }

  const autoInitials = deriveInitials(member.playerName ?? displayName);
  const shownInitials = initials.trim().toUpperCase() || autoInitials;
  return <form className="auth-form account-form" onSubmit={submit} noValidate>
    <p className="account-form-hint">{zh.profileHint}</p>

    <div className="avatar-picker">
      {avatar
        // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
        ? <img className="member-avatar" src={avatar} alt="" />
        : <div className="member-avatar" style={{ background: avatarHex(iconColour) }}>{shownInitials}</div>}
      <div className="avatar-picker-actions">
        <Button variant="quiet" onClick={() => fileInput.current?.click()}>{zh.upload}</Button>
        {avatar && <Button variant="quiet" onClick={() => setAvatar(null)}>{zh.remove}</Button>}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={event => { void pickAvatar(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {fieldErrors.avatar && <small className="field-error">{message(fieldErrors.avatar)}</small>}
    </div>

    {/* The badge the rest of the app draws, shown at the size it appears in a
        leaderboard row so the choice is judged at its real scale. */}
    <div className="badge-preview" aria-label={zh.badgePreview}>
      {avatar
        // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
        ? <i className="player-badge has-photo"><img src={avatar} alt="" /></i>
        : <i className="player-badge" style={{ background: avatarHex(iconColour) }}>{shownInitials}</i>}
      <p>{zh.badgeHint}</p>
    </div>

    <Field label={zh.initials} error={fieldErrors.initials}>
      <input value={initials} maxLength={3} placeholder={autoInitials} onChange={event => setInitials(event.target.value.toUpperCase())} />
      <small className="field-hint">{zh.initialsHint}</small>
    </Field>

    <div className="colour-field" role="group" aria-labelledby="icon-colour-label">
      <span className="colour-field-label" id="icon-colour-label">{zh.colour}</span>
      <div className="colour-grid" role="radiogroup" aria-label={zh.colour}>
        {AVATAR_COLOURS.map(option => <button key={option.id} type="button" role="radio"
          aria-checked={iconColour === option.id} aria-label={option.name} title={option.name}
          className={`colour-swatch${iconColour === option.id ? " active" : ""}`}
          style={{ background: option.hex }} onClick={() => setIconColour(option.id)} />)}
      </div>
      {fieldErrors.iconColour && <small className="field-error">{message(fieldErrors.iconColour)}</small>}
    </div>

    <Field label={zh.displayName} error={fieldErrors.displayName}>
      <input value={displayName} maxLength={40} onChange={event => setDisplayName(event.target.value)} />
    </Field>
    <Field label={zh.username} error={fieldErrors.username}>
      <input value={username} autoComplete="username" onChange={event => setUsername(event.target.value)} />
    </Field>
    <Field label={zh.email} error={fieldErrors.email}>
      <input value={email} type="email" autoComplete="email" onChange={event => setEmail(event.target.value)} />
    </Field>
    {identityChanged && <Field label={zh.current} error={fieldErrors.currentPassword}>
      <input value={currentPassword} type="password" autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)} />
    </Field>}
    {fieldErrors.form && <p className="form-error">{message(fieldErrors.form)}</p>}
    {status === "saved" && <p className="form-success">{zh.saved}</p>}
    <div className="account-form-actions">
      <Button variant="quiet" onClick={onDone}>{zh.cancel}</Button>
      <Button type="submit" disabled={status === "saving"}>{status === "saving" ? zh.saving : zh.save}</Button>
    </div>
  </form>;
}

function PasswordSection() {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return <section className="account-summary-row">
      <Button variant="quiet" className="link-trigger" onClick={() => setEditing(true)}>{zh.changePassword}</Button>
    </section>;
  }
  return <PasswordForm onDone={() => setEditing(false)} />;
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Validate as the member types, not just on submit — a mismatch or a too-short
  // password should show up immediately instead of after clicking "update".
  const liveErrors: Record<string, string> = {};
  if (password) { const error = checkPassword(password); if (error) liveErrors.password = error; }
  if (!liveErrors.password && confirm && password !== confirm) liveErrors.confirm = "password-mismatch";
  const errors_ = { ...fieldErrors, ...liveErrors };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = { ...liveErrors };
    if (!currentPassword) found.currentPassword = "password-required";
    setFieldErrors(found);
    if (Object.keys(found).length) return;

    setStatus("saving");
    const failure = await post("/api/account/password", { currentPassword, password });
    if (failure) {
      setStatus("idle");
      setFieldErrors({ [failure.field ?? "form"]: failure.error });
      return;
    }
    setCurrentPassword(""); setPassword(""); setConfirm("");
    setStatus("saved");
  }

  return <form className="auth-form account-form" onSubmit={submit} noValidate>
    <Field label={zh.current} error={errors_.currentPassword}>
      <input value={currentPassword} type="password" autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)} />
    </Field>
    <Field label={zh.newPassword} error={errors_.password}>
      <input value={password} type="password" autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
    </Field>
    <Field label={zh.confirmPassword} error={errors_.confirm}>
      <input value={confirm} type="password" autoComplete="new-password" onChange={event => setConfirm(event.target.value)} />
    </Field>
    {errors_.form && <p className="form-error">{message(errors_.form)}</p>}
    {status === "saved" && <p className="form-success">{zh.passwordSaved}</p>}
    <div className="account-form-actions">
      <Button variant="quiet" onClick={onDone}>{zh.cancel}</Button>
      <Button type="submit" disabled={status === "saving"}>{status === "saving" ? zh.saving : zh.updatePassword}</Button>
    </div>
  </form>;
}

function DangerZone({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (confirm.trim().toLowerCase() !== username) found.confirm = "confirm-mismatch";
    if (!currentPassword) found.currentPassword = "password-required";
    setFieldErrors(found);
    if (Object.keys(found).length) return;

    setStatus("saving");
    const failure = await post("/api/account/deactivate", { confirm, currentPassword });
    if (failure) {
      setStatus("idle");
      setFieldErrors({ [failure.field ?? "form"]: failure.error });
      return;
    }
    location.href = "/";
  }

  if (!open) {
    return <section className="account-danger-trigger">
      <Button variant="quiet" className="link-trigger link-trigger-muted" onClick={() => setOpen(true)}>{zh.dangerTrigger}</Button>
    </section>;
  }
  return <section className="account-danger">
    <p>{zh.dangerHint}</p>
    <form className="auth-form" onSubmit={submit} noValidate>
      <Field label={`${zh.confirmLabel}（${username}）`} error={fieldErrors.confirm}>
        <input value={confirm} onChange={event => setConfirm(event.target.value)} />
      </Field>
      <Field label={zh.current} error={fieldErrors.currentPassword}>
        <input value={currentPassword} type="password" autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)} />
      </Field>
      {fieldErrors.form && <p className="form-error">{message(fieldErrors.form)}</p>}
      <div className="account-danger-actions">
        <Button variant="quiet" onClick={() => { setOpen(false); setFieldErrors({}); }}>{zh.cancel}</Button>
        <Button variant="danger" type="submit" disabled={status === "saving"}>{status === "saving" ? zh.saving : zh.deactivate}</Button>
      </div>
    </form>
  </section>;
}
