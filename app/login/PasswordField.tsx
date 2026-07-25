"use client";

import { useState } from "react";

export default function PasswordField({ mode }: { mode: "login" | "signup" }) {
  const [visible, setVisible] = useState(false);
  const id = mode === "signup" ? "new-password" : "current-password";
  return (
    <label htmlFor={id}>
      密碼
      <span className="auth-password-field">
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={6}
          required
          aria-describedby={mode === "signup" ? "password-hint" : undefined}
        />
        <button type="button" onClick={() => setVisible(value => !value)} aria-pressed={visible}>
          {visible ? "隱藏" : "顯示"}
        </button>
      </span>
      {mode === "signup" && <small id="password-hint">至少 6 個字元</small>}
    </label>
  );
}
