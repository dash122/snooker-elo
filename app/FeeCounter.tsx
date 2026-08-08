"use client";

import { useEffect, useRef, useState } from "react";
import type { FeeEntry, FeeSession } from "../lib/fee-session";

type Props = { currentEmail: string; isAdmin: boolean; onClose: () => void };

function emptyEntry(): FeeEntry { return { id: crypto.randomUUID(), label: "", amount: 0 }; }

/** 波鐘計數機: a lightweight, standalone table-fee tally per player, independent of match/ELO
 *  records. List view shows recent sessions; the editor lets a member add/edit rows by hand, or
 *  seed them from a whiteboard photo via optional server-side OCR (reviewed before saving). */
export default function FeeCounter({ currentEmail, isAdmin, onClose }: Props) {
  const [sessions, setSessions] = useState<FeeSession[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<FeeSession | "new" | null>(null);

  useEffect(() => {
    fetch("/api/fee-sessions", { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setSessions)
      .catch(() => setError("無法載入紀錄，請稍後再試。"));
  }, []);

  function afterSave(session: FeeSession) {
    setSessions(list => {
      const rest = (list ?? []).filter(s => s.id !== session.id);
      return [session, ...rest];
    });
    setEditing(null);
  }
  function afterDelete(id: string) {
    setSessions(list => (list ?? []).filter(s => s.id !== id));
    setEditing(null);
  }

  if (editing) {
    return <FeeSessionEditor
      session={editing === "new" ? null : editing}
      canDelete={editing !== "new" && (isAdmin || editing.createdBy === currentEmail)}
      onCancel={() => setEditing(null)}
      onSaved={afterSave}
      onDeleted={afterDelete}
    />;
  }

  return <div className="fee-counter">
    <p className="kicker">波鐘計數機</p>
    <h2>桌費紀錄</h2>
    <p className="sub">記錄每位球員的波鐘累計，與比賽、ELO 無關。</p>
    {error && <p className="warning">{error}</p>}
    <button type="button" className="primary full" onClick={() => setEditing("new")}>＋ 新增紀錄</button>
    <div className="fee-session-list">
      {sessions == null && !error && <p className="sub">載入中…</p>}
      {sessions?.length === 0 && <p className="sub">尚未有任何紀錄。</p>}
      {sessions?.map(session => {
        const total = session.entries.reduce((sum, e) => sum + e.amount, 0);
        return <button key={session.id} type="button" className="fee-session-row" onClick={() => setEditing(session)}>
          <span className="fee-session-row-title">{session.title || new Date(session.createdAt).toLocaleDateString("zh-HK")}</span>
          <span className="fee-session-row-meta">{session.entries.length} 位球員 · 共 {total}</span>
          <span className="fee-session-row-by">{session.createdByName}</span>
        </button>;
      })}
    </div>
    <div className="sheet-actions"><button type="button" className="secondary" onClick={onClose}>關閉</button></div>
  </div>;
}

function FeeSessionEditor({ session, canDelete, onCancel, onSaved, onDeleted }: {
  session: FeeSession | null;
  canDelete: boolean;
  onCancel: () => void;
  onSaved: (session: FeeSession) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState(session?.title ?? "");
  const [entries, setEntries] = useState<FeeEntry[]>(session?.entries?.length ? session.entries : [emptyEntry()]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrNote, setOcrNote] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  function updateEntry(id: string, patch: Partial<FeeEntry>) {
    setEntries(list => list.map(e => e.id === id ? { ...e, ...patch } : e));
  }
  function removeEntry(id: string) {
    setEntries(list => list.filter(e => e.id !== id));
  }
  function addEntry() {
    setEntries(list => [...list, emptyEntry()]);
  }

  async function handlePhoto(file: File) {
    setOcrNote(""); setError("");
    if (file.size > 8 * 1024 * 1024) { setOcrNote("圖片太大，請使用小於 8MB 的相片。"); return; }
    setOcrBusy(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const r = await fetch("/api/fee-sessions/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (r.status === 501) { setOcrNote("此部署尚未設定自動辨識，請手動輸入。"); return; }
      if (!r.ok) { setOcrNote("辨識失敗，請手動輸入。"); return; }
      const { entries: read } = await r.json() as { entries: { label: string; amount: number }[] };
      if (!read?.length) { setOcrNote("未能從相片讀取到資料，請手動輸入或再試一次。"); return; }
      // Reviewed, not auto-saved: dropped straight into the same editable rows as manual entry, so
      // a misread digit is a two-tap fix rather than a silently wrong total.
      setEntries(current => {
        const blank = current.length === 1 && !current[0].label && !current[0].amount;
        const base = blank ? [] : current;
        return [...base, ...read.map(item => ({ id: crypto.randomUUID(), label: item.label.slice(0, 24), amount: Math.max(0, item.amount) }))];
      });
      setOcrNote(`已讀取 ${read.length} 筆，請核對後再儲存。`);
    } catch {
      setOcrNote("辨識失敗，請手動輸入。");
    } finally {
      setOcrBusy(false);
    }
  }

  async function save() {
    const cleaned = entries.map(e => ({ ...e, label: e.label.trim() })).filter(e => e.label);
    if (!cleaned.length) { setError("請至少輸入一位球員。"); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch(session ? `/api/fee-sessions/${session.id}` : "/api/fee-sessions", {
        method: session ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, entries: cleaned }),
      });
      if (!r.ok) { const body = await r.json().catch(() => null); setError(body?.error || "儲存失敗，請再試一次。"); return; }
      onSaved(await r.json());
    } catch {
      setError("儲存失敗，請再試一次。");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!session || !confirm("確定刪除此紀錄？")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/fee-sessions/${session.id}`, { method: "DELETE" });
      if (!r.ok) { setError("刪除失敗，請再試一次。"); return; }
      onDeleted(session.id);
    } catch {
      setError("刪除失敗，請再試一次。");
    } finally {
      setDeleting(false);
    }
  }

  const total = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return <div className="fee-counter">
    <p className="kicker">波鐘計數機</p>
    <h2>{session ? "編輯紀錄" : "新增紀錄"}</h2>
    <label>標題（選填）<input type="text" value={title} placeholder={new Date().toLocaleDateString("zh-HK")} onChange={e => setTitle(e.target.value)} /></label>

    <div className="fee-entry-list">
      {entries.map(entry => <div key={entry.id} className="fee-entry-row">
        <input type="text" placeholder="球員 / 縮寫" value={entry.label} maxLength={24} onChange={e => updateEntry(entry.id, { label: e.target.value })} />
        <input type="number" min={0} step={1} value={entry.amount} onChange={e => updateEntry(entry.id, { amount: Number(e.target.value) })} />
        <button type="button" className="fee-entry-remove" aria-label="刪除此列" onClick={() => removeEntry(entry.id)}>×</button>
      </div>)}
    </div>
    <button type="button" className="secondary full" onClick={addEntry}>＋ 新增球員</button>

    <div className="fee-photo-upload">
      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void handlePhoto(file); }} />
      <button type="button" className="secondary full" disabled={ocrBusy} onClick={() => fileInput.current?.click()}>
        {ocrBusy ? "辨識中…" : "📷 用白板相片自動填入"}
      </button>
      {ocrNote && <p className="sub">{ocrNote}</p>}
    </div>

    <p className="fee-total">合計：{total}</p>
    {error && <p className="warning">{error}</p>}
    <div className="sheet-actions">
      <button type="button" className="primary" disabled={saving} onClick={save}>{saving ? "儲存中…" : "儲存"}</button>
      <button type="button" className="secondary" onClick={onCancel}>取消</button>
      {canDelete && <button type="button" className="danger" disabled={deleting} onClick={remove}>刪除</button>}
    </div>
  </div>;
}
