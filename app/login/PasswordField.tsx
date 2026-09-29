"use client";

import { useState } from "react";
import { passwordStrength, MIN_PASSWORD } from "../api/account/validate";
import { useT } from "../components/I18nProvider";
import { msg } from "../../lib/i18n/translate";

const STRENGTH_LABEL = [msg("非常弱"), msg("弱"), msg("普通"), msg("良好"), msg("強")];

export default function PasswordField({
  mode,
  value,
  onChange,
}: {
  mode: "login" | "signup";
  value?: string;
  onChange?: (value: string) => void;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const id = mode === "signup" ? "new-password" : "current-password";
  const strength = mode === "signup" ? passwordStrength(value ?? "") : 0;
  return (
    <label htmlFor={id}>
      {t("密碼")}<span className="auth-password-field">
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? MIN_PASSWORD : undefined}
          required
          value={mode === "signup" ? value ?? "" : undefined}
          onChange={mode === "signup" ? event => onChange?.(event.target.value) : undefined}
          aria-describedby={mode === "signup" ? "password-hint" : undefined}
        />
        <button type="button" onClick={() => setVisible(value => !value)} aria-pressed={visible}>
          {visible ? t("隱藏") : t("顯示")}
        </button>
      </span>
      {mode === "signup" && (
        <>
          <span className={`password-strength password-strength-${strength}`} aria-hidden="true">
            {[0, 1, 2, 3].map(bar => (
              <i key={bar} className={bar < strength ? "filled" : undefined}/>
            ))}
          </span>
          <small id="password-hint">
            {t("至少 {MIN_PASSWORD} 個字元", {MIN_PASSWORD})}{value && t("　強度：{v}", {v: t(STRENGTH_LABEL[strength])})}
          </small>
        </>
      )}
    </label>
  );
}
