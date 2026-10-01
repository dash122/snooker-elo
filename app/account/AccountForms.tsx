"use client";

import { useRef, useState } from "react";
import { AVATAR_COLOURS, DEFAULT_AVATAR, avatarHex } from "../avatar-colours";
import { checkAvatar, checkDisplayName, checkEmail, checkInitials, checkPassword, checkUsername, deriveInitials, MAX_AVATAR_CHARS } from "../api/account/validate";
import { Button } from "../components/ui/Primitives";
import { useT, useTranslated } from "../components/I18nProvider";
import type { Translator } from "../../lib/i18n/translate";
import { msg } from "../../lib/i18n/translate";

const zhTable = {
  email: msg("電郵"),
  editProfile: msg("編輯資料"), profileHint: msg("更改使用者名稱或電郵需輸入目前密碼。"),
  profileHintGoogle: msg("你以 Google 登入，更改資料不需要密碼。"),
  avatar: msg("頭像"), upload: msg("上傳圖片"), remove: msg("移除"),
  initials: msg("頭像縮寫"), initialsHint: msg("留空則使用球員姓名自動產生。"),
  colour: msg("圖示顏色"), badgePreview: msg("球員圖示預覽"),
  badgeHint: msg("縮寫與顏色會即時套用到排行榜、球員卡及對戰紀錄；上傳圖片後，圖片會取代縮寫顯示。"),
  displayName: msg("顯示名稱"), username: msg("使用者名稱"),
  current: msg("目前密碼"), save: msg("儲存變更"), saving: msg("儲存中…"), saved: msg("已儲存。"), cancel: msg("取消"),
  changePassword: msg("變更密碼"), newPassword: msg("新密碼"), confirmPassword: msg("確認新密碼"), updatePassword: msg("更新密碼"),
  passwordSaved: msg("密碼已更新。"),
  setPassword: msg("設定密碼"), setPasswordHint: msg("你的帳戶以 Google 建立，尚未設定密碼。設定後即可同時使用密碼登入。"), savePassword: msg("設定密碼"),
  dangerTrigger: msg("停用帳戶"), dangerHint: msg("停用後將立即登出，且無法再登入，需由管理員重新啟用。球員成績不會被刪除。"),
  confirmLabel: msg("輸入使用者名稱以確認"), deactivate: msg("確認停用"),
};

const errors: Record<string, string> = {
  "username-format": msg("使用者名稱需 3-24 個字元，僅限英文、數字、. _ -。"),
  "email-format": msg("電郵格式不正確。"),
  "display-name-format": msg("顯示名稱需 1-40 個字元。"),
  "password-short": msg("密碼至少需 6 個字元。"),
  "password-required": msg("請輸入目前密碼。"),
  "password-wrong": msg("目前密碼不正確。"),
  "password-same": msg("新密碼不能與目前密碼相同。"),
  "password-mismatch": msg("兩次輸入的新密碼不一致。"),
  "username-taken": msg("該使用者名稱已被使用。"),
  "email-taken": msg("該電郵已被使用。"),
  "avatar-large": msg("圖片過大，請選擇較小的圖片。"),
  "avatar-format": msg("僅支援 PNG、JPEG 或 WebP 圖片。"),
  "initials-format": msg("縮寫需為 1-3 個英文字母。"),
  "colour-unknown": msg("請從色板中選擇顏色。"),
  "confirm-mismatch": msg("輸入的使用者名稱不符。"),
  "last-admin": msg("您是唯一的管理員，無法停用帳戶。"),
  "no-password": msg("請先設定帳戶密碼。"),
  unknown: msg("操作失敗，請稍後再試。"),
};

const message = (t: Translator, code: string) => t(errors[code] ?? errors.unknown);

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

type Member = { username: string; email: string; displayName: string; avatar?: string | null; initials?: string | null; iconColour?: string | null; playerName?: string; googleLinked?: boolean; hasPassword?: boolean };

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const t = useT();
  return <label className={error ? "field-invalid" : undefined}>
    {label}{children}
    {error && <small className="field-error">{message(t, error)}</small>}
  </label>;
}

export default function AccountForms({ member, googleStatus }: { member: Member; googleStatus?: string }) {
  // An account created by signing in with Google has no password of its own,
  // so nothing on this page may ask it to confirm with one.
  const hasPassword = member.hasPassword !== false;
  return <div className="settings-list">
    <ProfileSection member={member} hasPassword={hasPassword} />
    <PasswordSection hasPassword={hasPassword} />
    <GoogleConnection linked={Boolean(member.googleLinked)} status={googleStatus} hasPassword={hasPassword} />
    <DangerZone username={member.username} hasPassword={hasPassword} />
  </div>;
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.73A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.19.29-1.73V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>;
}

function GoogleConnection({ linked, status, hasPassword }: { linked: boolean; status?: string; hasPassword: boolean }) {
  const t = useT();
  const [isLinked, setIsLinked] = useState(linked);
  const [disconnecting, setDisconnecting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [disconnectStatus, setDisconnectStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [disconnectError, setDisconnectError] = useState("");
  const message_ = status === "connected" ? t("Google 帳戶已成功連結。") : status === "already-connected" ? t("這個 Google 帳戶早已連結。") : status === "account-already-linked" ? t("你的會員帳戶已連結另一個 Google 帳戶。") : status === "google-in-use" ? t("這個 Google 帳戶已連結至另一個會員帳戶。") : status === "cancelled" ? t("你已取消授權，帳戶沒有任何變更。") : status === "session-required" ? t("登入狀態已失效，請重新登入再試。") : status ? t("暫時未能連結 Google，請稍後再試。") : null;
  const message_2 = disconnectStatus === "success" ? t("Google 帳戶已解除連結。你仍可使用帳戶密碼登入。") : message_;

  async function disconnect(event: React.FormEvent) {
    event.preventDefault();
    if (hasPassword && !currentPassword) return setDisconnectError(t("請輸入目前密碼以確認。"));
    setDisconnectStatus("saving"); setDisconnectError("");
    const failure = await post("/api/account/google", { currentPassword });
    if (failure) {
      setDisconnectStatus("error");
      setDisconnectError(failure.error === "password-wrong" ? t("目前密碼不正確，Google 仍然保持連結。") : failure.error === "rate-limited" ? t("嘗試次數過多，請稍後再試。") : failure.error === "no-password" ? t("請先設定帳戶密碼，否則解除連結後將無法登入。") : failure.error === "not-linked" ? t("Google 帳戶已經解除連結。") : t("暫時未能解除連結，請稍後再試。"));
      return;
    }
    setIsLinked(false); setDisconnecting(false); setCurrentPassword(""); setDisconnectStatus("success");
  }

  return <section className="google-connection" aria-labelledby="google-connection-title">
    <div className="google-connection-copy"><span className="google-mark"><GoogleMark /></span><div><h3 id="google-connection-title">{t("Google 登入")}</h3><p>{isLinked ? t("已連結") : t("連結後可免密碼登入；不會更改你的會員電郵或球員紀錄。")}</p></div></div>
    {isLinked ? <div className="google-linked-actions"><span className="google-linked"><i aria-hidden="true">✓</i></span>{hasPassword && <button type="button" className="google-disconnect-trigger" onClick={() => { setDisconnecting(true); setDisconnectStatus("idle"); }}>{t("解除連結")}</button>}</div> : <a className="google-connect-button" href="/api/auth/google?intent=connect">{t("連結 Google")}</a>}
    {disconnecting && <form className="google-disconnect-form" onSubmit={disconnect}>
      <p>{t("解除後將無法使用 Google 登入。請輸入目前密碼，確認你仍可使用密碼登入帳戶。")}</p>
      <label htmlFor="google-disconnect-password">{t("目前密碼")}<input id="google-disconnect-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} aria-invalid={Boolean(disconnectError)} /></label>
      {disconnectError && <p className="field-error" role="alert">{disconnectError}</p>}
      <div><Button variant="quiet" onClick={() => { setDisconnecting(false); setCurrentPassword(""); setDisconnectError(""); }}>{t("取消")}</Button><Button variant="danger" type="submit" disabled={disconnectStatus === "saving"}>{disconnectStatus === "saving" ? t("解除中…") : t("確認解除")}</Button></div>
    </form>}
    {message_2 && <p className={disconnectStatus === "success" || status === "connected" || status === "already-connected" ? "form-success google-status" : "form-error google-status"} role="status">{message_2}</p>}
  </section>;
}

// Read-only by default — most visits are to check a stat, not to edit
// anything. Editing is an explicit second step.
function ProfileSection({ member, hasPassword }: { member: Member; hasPassword: boolean }) {
  const t = useT();
  const zh = useTranslated(zhTable);
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return <section className="settings-row">
      <div className="settings-row-copy"><h3>{t("個人資料")}</h3><p>{member.email}</p></div>
      <Button variant="secondary" aria-label={zh.editProfile} onClick={() => setEditing(true)}>{t("編輯")}</Button>
    </section>;
  }
  return <ProfileForm member={member} hasPassword={hasPassword} onDone={() => setEditing(false)} />;
}

function ProfileForm({ member, hasPassword, onDone }: { member: Member; hasPassword: boolean; onDone: () => void }) {
  const t = useT();
  const zh = useTranslated(zhTable);
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

  const identityChanged = hasPassword && (username.trim().toLowerCase() !== member.username || email.trim().toLowerCase() !== member.email);

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
    <p className="account-form-hint">{hasPassword ? zh.profileHint : zh.profileHintGoogle}</p>

    <div className="avatar-picker">
      {avatar
        // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
        ? <img className="member-avatar" src={avatar} alt="" />
        : <div className="member-avatar" style={{ background: avatarHex(iconColour) }}>{shownInitials}</div>}
      <div className="avatar-picker-side">
        <div className="avatar-picker-actions">
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>{zh.upload}</Button>
          {avatar && <Button variant="quiet" onClick={() => setAvatar(null)}>{zh.remove}</Button>}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={event => { void pickAvatar(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        {/* The badge the rest of the app draws, at the size it appears in a leaderboard row. */}
        <div className="badge-preview" aria-label={zh.badgePreview}>
          {avatar
            // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
            ? <i className="player-badge has-photo"><img src={avatar} alt="" /></i>
            : <i className="player-badge" style={{ background: avatarHex(iconColour) }}>{shownInitials}</i>}
          <span>{zh.badgePreview}</span>
        </div>
      </div>
      {fieldErrors.avatar && <small className="field-error">{message(t, fieldErrors.avatar)}</small>}
    </div>

    <Field label={zh.initials} error={fieldErrors.initials}>
      <input value={initials} maxLength={3} placeholder={autoInitials} onChange={event => setInitials(event.target.value.toUpperCase())} />
      <small className="field-hint">{zh.initialsHint}</small>
    </Field>

    <div className="colour-field" role="group" aria-labelledby="icon-colour-label">
      <span className="colour-field-label" id="icon-colour-label">{zh.colour}</span>
      <div className="colour-grid" role="radiogroup" aria-label={zh.colour}>
        {AVATAR_COLOURS.map(option => <button key={option.id} type="button" role="radio"
          aria-checked={iconColour === option.id} aria-label={t(option.name)} title={t(option.name)}
          className={`colour-swatch${iconColour === option.id ? " active" : ""}`}
          style={{ background: option.hex }} onClick={() => setIconColour(option.id)} />)}
      </div>
      {fieldErrors.iconColour && <small className="field-error">{message(t, fieldErrors.iconColour)}</small>}
    </div>

    <div className="account-form-grid">
      <Field label={zh.displayName} error={fieldErrors.displayName}>
        <input value={displayName} maxLength={40} onChange={event => setDisplayName(event.target.value)} />
      </Field>
      <Field label={zh.username} error={fieldErrors.username}>
        <input value={username} autoComplete="username" onChange={event => setUsername(event.target.value)} />
      </Field>
      <Field label={zh.email} error={fieldErrors.email}>
        <input value={email} type="email" autoComplete="email" onChange={event => setEmail(event.target.value)} />
      </Field>
    </div>
    {identityChanged && <Field label={zh.current} error={fieldErrors.currentPassword}>
      <input value={currentPassword} type="password" autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)} />
    </Field>}
    {fieldErrors.form && <p className="form-error">{message(t, fieldErrors.form)}</p>}
    {status === "saved" && <p className="form-success">{zh.saved}</p>}
    <div className="account-form-actions">
      <Button variant="quiet" onClick={onDone}>{zh.cancel}</Button>
      <Button type="submit" disabled={status === "saving"}>{status === "saving" ? zh.saving : zh.save}</Button>
    </div>
  </form>;
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const zh = useTranslated(zhTable);
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return <section className="settings-row">
      <div className="settings-row-copy"><h3>{t("密碼")}</h3><p>{hasPassword ? "••••••••" : zh.setPasswordHint}</p></div>
      <Button variant="secondary" aria-label={hasPassword ? zh.changePassword : zh.setPassword} onClick={() => setEditing(true)}>{hasPassword ? t("編輯") : zh.setPassword}</Button>
    </section>;
  }
  return <PasswordForm hasPassword={hasPassword} onDone={() => setEditing(false)} />;
}

function PasswordForm({ hasPassword, onDone }: { hasPassword: boolean; onDone: () => void }) {
  const t = useT();
  const zh = useTranslated(zhTable);
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
    if (hasPassword && !currentPassword) found.currentPassword = "password-required";
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
    {hasPassword
      ? <Field label={zh.current} error={errors_.currentPassword}>
          <input value={currentPassword} type="password" autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)} />
        </Field>
      : <p className="account-form-hint">{zh.setPasswordHint}</p>}
    <Field label={zh.newPassword} error={errors_.password}>
      <input value={password} type="password" autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
    </Field>
    <Field label={zh.confirmPassword} error={errors_.confirm}>
      <input value={confirm} type="password" autoComplete="new-password" onChange={event => setConfirm(event.target.value)} />
    </Field>
    {errors_.form && <p className="form-error">{message(t, errors_.form)}</p>}
    {status === "saved" && <p className="form-success">{zh.passwordSaved}</p>}
    <div className="account-form-actions">
      <Button variant="quiet" onClick={onDone}>{zh.cancel}</Button>
      <Button type="submit" disabled={status === "saving"}>{status === "saving" ? zh.saving : hasPassword ? zh.updatePassword : zh.savePassword}</Button>
    </div>
  </form>;
}

function DangerZone({ username, hasPassword }: { username: string; hasPassword: boolean }) {
  const t = useT();
  const zh = useTranslated(zhTable);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (confirm.trim().toLowerCase() !== username) found.confirm = "confirm-mismatch";
    if (hasPassword && !currentPassword) found.currentPassword = "password-required";
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
    return <section className="settings-danger">
      <Button variant="quiet" className="link-trigger link-trigger-muted" onClick={() => setOpen(true)}>{zh.dangerTrigger}</Button>
    </section>;
  }
  return <section className="account-danger">
    <p>{zh.dangerHint}</p>
    <form className="auth-form" onSubmit={submit} noValidate>
      <Field label={t("{confirmLabel}（{username}）", {confirmLabel: zh.confirmLabel, username})} error={fieldErrors.confirm}>
        <input value={confirm} onChange={event => setConfirm(event.target.value)} />
      </Field>
      {hasPassword && <Field label={zh.current} error={fieldErrors.currentPassword}>
        <input value={currentPassword} type="password" autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)} />
      </Field>}
      {fieldErrors.form && <p className="form-error">{message(t, fieldErrors.form)}</p>}
      <div className="account-danger-actions">
        <Button variant="quiet" onClick={() => { setOpen(false); setFieldErrors({}); }}>{zh.cancel}</Button>
        <Button variant="danger" type="submit" disabled={status === "saving"}>{status === "saving" ? zh.saving : zh.deactivate}</Button>
      </div>
    </form>
  </section>;
}
