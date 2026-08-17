"use client";

import { useState } from "react";
import PasswordField from "./PasswordField";
import { checkPassword } from "../api/account/validate";
import { useAvailabilityCheck } from "./useAvailabilityCheck";

export default function SignupForm() {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const usernameValid = username.trim().length >= 3;
  const emailValid = email.trim().includes("@");
  const usernameCheck = useAvailabilityCheck("username", username, usernameValid);
  const emailCheck = useAvailabilityCheck("email", email, emailValid);
  const passwordsMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  const canSubmit =
    displayName.trim().length >= 2 &&
    usernameValid &&
    emailValid &&
    !checkPassword(password) &&
    confirmPassword === password &&
    !usernameCheck.checking &&
    !emailCheck.checking &&
    !usernameCheck.taken &&
    !emailCheck.taken;

  return (
    <form className="auth-form auth-main-form" action="/api/auth/register" method="post">
      <label htmlFor="display-name">
        球員顯示名稱
        <input
          id="display-name" name="displayName" autoComplete="name" required minLength={2}
          value={displayName} onChange={event => setDisplayName(event.target.value)}
        />
        <small>這個名稱會顯示在排行榜及賽事紀錄。</small>
      </label>
      <label htmlFor="username">
        使用者名稱
        <input
          id="username" name="username" autoComplete="username" required minLength={3}
          value={username} onChange={event => setUsername(event.target.value)}
          aria-invalid={usernameCheck.taken || undefined}
        />
        {usernameCheck.taken && <small className="field-error" role="alert">此使用者名稱已被使用。</small>}
      </label>
      <label htmlFor="email">
        電郵
        <input
          id="email" name="email" type="email" autoComplete="email" required
          value={email} onChange={event => setEmail(event.target.value)}
          aria-invalid={emailCheck.taken || undefined}
        />
        {emailCheck.taken && <small className="field-error" role="alert">此電郵已被使用。</small>}
      </label>
      <PasswordField mode="signup" value={password} onChange={setPassword}/>
      <label htmlFor="confirm-password">
        確認密碼
        <input
          id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required
          value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
          aria-invalid={passwordsMismatch || undefined}
        />
        {passwordsMismatch && <small className="field-error" role="alert">兩次密碼不相符。</small>}
      </label>
      <button className="primary auth-submit" type="submit" disabled={!canSubmit}>
        建立帳戶及球員檔案
      </button>
    </form>
  );
}
