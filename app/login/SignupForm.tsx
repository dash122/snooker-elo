"use client";

import { useState } from "react";
import PasswordField from "./PasswordField";
import { checkDisplayName, checkDisallowedText, checkEmail, checkPassword, checkUsername } from "../api/account/validate";
import { useAvailabilityCheck } from "./useAvailabilityCheck";
import { Button } from "../components/ui/Primitives";
import { useT } from "../components/I18nProvider";

export default function SignupForm() {
  const t = useT();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const displayNameError = checkDisplayName(displayName);
  const usernameError = checkUsername(username);
  const emailError = checkEmail(email);
  const usernameDisallowed = checkDisallowedText(username);
  const emailDisallowed = checkDisallowedText(email);
  const displayNameDisallowed = checkDisallowedText(displayName);
  const usernameValid = !usernameError && !usernameDisallowed;
  const emailValid = !emailError && !emailDisallowed;
  const usernameCheck = useAvailabilityCheck("username", username, usernameValid);
  const emailCheck = useAvailabilityCheck("email", email, emailValid);
  const passwordsMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  const canSubmit =
    !displayNameError &&
    !displayNameDisallowed &&
    !usernameError &&
    !usernameDisallowed &&
    !emailError &&
    !emailDisallowed &&
    !checkPassword(password) &&
    confirmPassword === password &&
    !usernameCheck.checking &&
    !emailCheck.checking &&
    !usernameCheck.taken &&
    !emailCheck.taken;

  return (
    <form className="auth-form auth-main-form" action="/api/auth/register" method="post">
      <label htmlFor="display-name">
        {t("球員顯示名稱")}<input
          id="display-name" name="displayName" autoComplete="name" required minLength={2}
          value={displayName} onChange={event => setDisplayName(event.target.value)}
          aria-invalid={Boolean(displayNameError || displayNameDisallowed) || undefined}
        />
        <small>{t("這個名稱會顯示在排行榜及賽事紀錄。")}</small>
        {(displayNameError || displayNameDisallowed) && <small className="field-error" role="alert">{displayNameDisallowed ? t("內容含有不當用語，請修改後再提交。") : t("顯示名稱只能使用中英數字、空白、! 及 ?。")}</small>}
      </label>
      <label htmlFor="username">
        {t("使用者名稱")}<input
          id="username" name="username" autoComplete="username" required minLength={3}
          value={username} onChange={event => setUsername(event.target.value)}
          aria-invalid={Boolean(usernameError || usernameDisallowed || usernameCheck.taken) || undefined}
        />
        {usernameError && <small className="field-error" role="alert">{t("使用者名稱須為 3 至 24 個英文字母、數字或 .。")}</small>}
        {usernameDisallowed && <small className="field-error" role="alert">{t("內容含有不當用語，請修改後再提交。")}</small>}
        {usernameCheck.taken && <small className="field-error" role="alert">{t("此使用者名稱已被使用。")}</small>}
      </label>
      <label htmlFor="email">
        {t("電郵")}<input
          id="email" name="email" type="email" autoComplete="email" required
          value={email} onChange={event => setEmail(event.target.value)}
          aria-invalid={Boolean(emailError || emailDisallowed || emailCheck.taken) || undefined}
        />
        {emailError && <small className="field-error" role="alert">{t("請輸入有效電郵地址。")}</small>}
        {emailDisallowed && <small className="field-error" role="alert">{t("內容含有不當用語，請修改後再提交。")}</small>}
        {emailCheck.taken && <small className="field-error" role="alert">{t("此電郵已被使用。")}</small>}
      </label>
      <PasswordField mode="signup" value={password} onChange={setPassword}/>
      <label htmlFor="confirm-password">
        {t("確認密碼")}<input
          id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required
          value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
          aria-invalid={passwordsMismatch || undefined}
        />
        {passwordsMismatch && <small className="field-error" role="alert">{t("兩次密碼不相符。")}</small>}
      </label>
      <Button className="auth-submit" type="submit" disabled={!canSubmit}>
        {t("建立帳戶及球員檔案")}</Button>
    </form>
  );
}
