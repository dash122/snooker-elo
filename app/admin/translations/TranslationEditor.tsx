"use client";

import { useMemo, useState } from "react";
import { Button, EmptyState, InlineNotice } from "../../components/ui/Primitives";

export type TranslationRow = { key: string; source: string; original: string; value: string };

const PAGE_SIZE = 50;

function Row({ row }: { row: TranslationRow }) {
  const [saved, setSaved] = useState(row.value);
  const [draft, setDraft] = useState(row.value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = draft !== saved;
  const edited = saved !== row.original;

  async function send(method: "PUT" | "DELETE", value?: string) {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/translations", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ key: row.key, value }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "儲存失敗"); return; }
      const next = method === "DELETE" ? row.original : draft.trim();
      setSaved(next); setDraft(next);
    } catch { setError("儲存失敗"); }
    finally { setPending(false); }
  }

  return <li className="translation-row">
    <p className="translation-source" lang="zh-Hant">{row.source}</p>
    <textarea className="translation-input" aria-label={`English: ${row.source}`} rows={Math.max(1, Math.ceil(draft.length / 56))} value={draft} aria-invalid={error ? true : undefined}
      onChange={event => { setDraft(event.target.value); setError(""); }} />
    {error && <p className="translation-error" role="alert">{error}</p>}
    <div className="translation-actions">
      <Button type="button" variant="secondary" disabled={!dirty} loading={pending} onClick={() => send("PUT", draft)}>儲存</Button>
      {edited && <Button type="button" variant="quiet" disabled={pending} onClick={() => send("DELETE")}>還原預設</Button>}
      {edited && !dirty && <span className="translation-badge">已修改</span>}
    </div>
  </li>;
}

export default function TranslationEditor({ rows }: { rows: TranslationRow[] }) {
  const [query, setQuery] = useState("");
  const [editedOnly, setEditedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => (!editedOnly || row.value !== row.original) && (!needle || `${row.source} ${row.value} ${row.key}`.toLowerCase().includes(needle)));
  }, [rows, query, editedOnly]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return <div className="translation-editor">
    <div className="translation-filters">
      <input type="search" className="translation-search" aria-label="搜尋" placeholder="搜尋中文或英文…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <label className="translation-toggle"><input type="checkbox" checked={editedOnly} onChange={event => { setEditedOnly(event.target.checked); setPage(0); }} />只顯示已修改</label>
    </div>
    <InlineNotice title={`${filtered.length} / ${rows.length}`}>每則翻譯獨立儲存。</InlineNotice>
    {visible.length === 0
      ? <EmptyState title="沒有符合的翻譯" description="請嘗試其他關鍵字。" />
      : <ul className="translation-list">{visible.map(row => <Row key={row.key} row={row} />)}</ul>}
    {pages > 1 && <nav className="translation-pager" aria-label="分頁">
      <Button type="button" variant="quiet" disabled={current === 0} onClick={() => setPage(current - 1)}>上一頁</Button>
      <span>{current + 1} / {pages}</span>
      <Button type="button" variant="quiet" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>下一頁</Button>
    </nav>}
  </div>;
}
