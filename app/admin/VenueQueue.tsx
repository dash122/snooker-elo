"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Button, Chip, FormField, InlineNotice, Skeleton } from "../components/ui/Primitives";
import { Dialog } from "../components/ui/Overlay";
import { cityById } from "../../lib/play/geo";

const VenueMap = lazy(() => import("../play/VenueMap"));

/* Moderation of member-added venues. A new venue is usable straight away and shows as unverified;
   an admin approves it, fixes its name or pin, rejects it, or merges it into the venue it duplicates
   (sessions and requests that used the duplicate move across). */

type Venue = {
  id: string; name: string; nameEn: string | null; city: string | null; tz: string | null; lat: number | null; lng: number | null;
  status: "unverified" | "verified" | "rejected"; active: boolean; mergedInto: string | null; createdByName: string | null; sessions: number;
};

const LABEL = { unverified: "未核實", verified: "已核實", rejected: "已拒絕" } as const;

export default function VenueQueue() {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; nameEn: string; lat: number | null; lng: number | null; moved: boolean } | null>(null);
  const [merging, setMerging] = useState<{ id: string; into: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/venues", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "未能載入場地。");
      setVenues(body.venues as Venue[]);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "未能載入場地。"); }
  }, []);
  useEffect(() => { const first = setTimeout(() => void load(), 0); return () => clearTimeout(first); }, [load]);

  async function act(action: string, values: Record<string, unknown>) {
    setBusy(String(values.id));
    setError("");
    try {
      const response = await fetch("/api/admin/venues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...values }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "未能更新場地。");
      setEditing(null);
      setMerging(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "未能更新場地。"); }
    setBusy("");
  }

  if (!venues) return error ? <InlineNotice tone="danger" title="未能載入">{error}</InlineNotice> : <Skeleton height="4rem" />;
  const live = venues.filter((v) => v.active && !v.mergedInto);

  return (
    <div className="admin-venues">
      {error && <InlineNotice tone="danger" title="未能完成">{error}</InlineNotice>}
      <ul className="admin-venue-list">
        {venues.map((v) => (
          <li key={v.id} className="admin-venue-row">
            <div className="admin-venue-main">
              <b>{v.name}</b>{v.nameEn ? <small> · {v.nameEn}</small> : null}
              <small>{[cityById(v.city ?? "")?.label ?? v.city ?? "未設城市", v.createdByName ? `由 ${v.createdByName} 新增` : null, `${v.sessions} 個約戰`].filter(Boolean).join(" · ")}</small>
              <Chip tone={v.status === "verified" ? "success" : v.status === "unverified" ? "warning" : "danger"}>{LABEL[v.status]}</Chip>
            </div>
            <div className="admin-venue-actions">
              {v.lat != null && v.lng != null && <Button type="button" variant="quiet" onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? "收埋地圖" : "地圖"}</Button>}
              {v.status !== "verified" && v.active && <Button type="button" loading={busy === v.id} onClick={() => void act("approve", { id: v.id })}>核實</Button>}
              {v.active && <Button type="button" variant="secondary" onClick={() => { setEditing({ id: v.id, name: v.name, nameEn: v.nameEn ?? "", lat: v.lat, lng: v.lng, moved: false }); setMerging(null); }}>修改</Button>}
              {v.active && live.length > 1 && <Button type="button" variant="secondary" onClick={() => setMerging({ id: v.id, into: live.find((o) => o.id !== v.id)!.id })}>合併</Button>}
              {v.active && v.status !== "rejected" && <Button type="button" variant="danger" onClick={() => void act("reject", { id: v.id })}>拒絕</Button>}
            </div>
            {open === v.id && v.lat != null && v.lng != null && <Suspense fallback={<Skeleton height="12rem" />}><VenueMap lat={v.lat} lng={v.lng} label={v.name} /></Suspense>}
            {merging?.id === v.id && (
              <form className="admin-venue-edit" onSubmit={(e) => { e.preventDefault(); void act("merge", { id: v.id, into: merging.into }); }}>
                <label>合併入<select value={merging.into} onChange={(e) => setMerging({ ...merging, into: e.target.value })}>
                  {live.filter((o) => o.id !== v.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <Button type="submit" variant="danger" loading={busy === v.id}>確定合併</Button>
                <Button type="button" variant="quiet" onClick={() => setMerging(null)}>取消</Button>
              </form>
            )}
          </li>
        ))}
        {venues.length === 0 && <li>暫時未有場地。</li>}
      </ul>
      <Dialog open={!!editing} title="修改場地" onClose={() => setEditing(null)}>
        {editing && (() => {
          const v = venues.find((x) => x.id === editing.id);
          const centre = cityById(v?.city ?? "")?.center ?? { lat: 22.3193, lng: 114.1694 };
          return (
            <form className="admin-venue-dialog" onSubmit={(e) => { e.preventDefault(); void act("edit", { id: editing.id, name: editing.name, nameEn: editing.nameEn, ...(editing.moved ? { lat: editing.lat, lng: editing.lng } : {}) }); }}>
              <FormField label="名稱"><input value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></FormField>
              <FormField label="英文名稱"><input value={editing.nameEn} maxLength={60} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} /></FormField>
              <FormField label="場地位置" hint={editing.lat == null ? "未設定位置。拖動標記或點擊地圖。" : "拖動標記或點擊地圖。"}>
                <Suspense fallback={<Skeleton height="14rem" />}>
                  <VenueMap lat={editing.lat ?? centre.lat} lng={editing.lng ?? centre.lng} editable label={editing.name || (v?.name ?? "")}
                    zoom={editing.lat == null ? 11 : 16} onChange={(lat, lng) => setEditing((cur) => (cur ? { ...cur, lat, lng, moved: true } : cur))} />
                </Suspense>
              </FormField>
              <div className="admin-venue-dialog-actions">
                <Button type="button" variant="quiet" onClick={() => setEditing(null)}>放棄</Button>
                <Button type="submit" loading={busy === editing.id}>儲存</Button>
              </div>
            </form>
          );
        })()}
      </Dialog>
    </div>
  );
}
