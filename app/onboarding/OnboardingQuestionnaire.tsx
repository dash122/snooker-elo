"use client";

import { useState } from "react";

const questionOne = [
  ["700", "連白波都打唔到／打唔中"], ["900", "大部分情況都可以打中目標波"],
  ["1100", "可以穩定打入一個波"], ["1300", "可以穩定連續打入一組（兩個）波"],
  ["1500", "可以打到多杆（15+）"], ["1700", "可以打到多杆（30+）"], ["1900", "可以打到50+"],
] as const;
const questionTwo = [["2000", "32強或以下"], ["2100", "16強"], ["2200", "8強"], ["2300", "4強或以上"]] as const;

export default function OnboardingQuestionnaire({ displayName }: { displayName: string }) {
  const [q1, setQ1] = useState<string | null>(null);
  const [q2, setQ2] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [finalRating, setFinalRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function chooseQ1(value: string) {
    setQ1(value);
    if (value !== "1900") setQ2(null);
    setError("");
  }

  async function submit() {
    if (!q1) return setError("請完成第一條問題。");
    if (q1 === "1900" && !q2) return setError("請完成第二條問題。");
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q1, q2 }) });
    const result = await response.json() as { finalRating?: number; error?: string };
    setSubmitting(false);
    if (!response.ok) return setError(result.error ?? "未能儲存評級，請稍後再試。");
    setFinalRating(result.finalRating ?? null);
  }

  if (finalRating !== null) return <main className="onboarding-page"><section className="onboarding-confirm" aria-live="polite"><span className="onboarding-mark">SCAA</span><p className="onboarding-kicker">歡迎加入，{displayName}</p><h1>你的初始評級為：{finalRating}</h1><p>評級已儲存。由第一局開始，讓每一局都推動進步。</p><a className="onboarding-home-link" href="/">進入排行榜</a></section></main>;

  return <main className="onboarding-page"><section className="onboarding-card"><span className="onboarding-mark">SCAA</span><p className="onboarding-kicker">新會員設定</p><h1>了解你嘅打波水平</h1><p className="onboarding-intro">答幾條問題，幫你設定一個更貼近實力嘅初始評級。</p><div className="onboarding-question"><h2>你認為自己現在的打波水平大約是？</h2><div className="onboarding-options">{questionOne.map(([value, label]) => <button key={value} type="button" className={`onboarding-option${q1 === value ? " is-selected" : ""}`} aria-pressed={q1 === value} onClick={() => chooseQ1(value)}><span>{label}</span><b>{value}</b></button>)}</div></div><div className={`onboarding-secondary${q1 === "1900" ? " is-visible" : ""}`} aria-hidden={q1 !== "1900"}><div className="onboarding-question"><h2>你喺香港公開賽（Hong Kong Open）嘅最好成績係？</h2><div className="onboarding-options onboarding-options-compact">{questionTwo.map(([value, label]) => <button key={value} type="button" className={`onboarding-option${q2 === value ? " is-selected" : ""}`} aria-pressed={q2 === value} tabIndex={q1 === "1900" ? 0 : -1} onClick={() => setQ2(value)}><span>{label}</span><b>{value}</b></button>)}</div></div></div>{error && <p className="onboarding-error" role="alert">{error}</p>}<button type="button" className="onboarding-submit" onClick={submit} disabled={submitting}>{submitting ? "儲存中…" : "提交"}</button></section></main>;
}