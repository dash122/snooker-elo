"use client";
import { lazy, Suspense, useState, type FormEvent } from "react";
import { Button, FormField, InlineNotice, Skeleton } from "../components/ui/Primitives";
import { Sheet } from "../components/ui/Overlay";
import { useT } from "../components/I18nProvider";
import { cityById } from "../../lib/play/geo";
import type { Dashboard } from "../../lib/play/dashboard";
import type { PlayVenue } from "../../lib/play/types";
import type { ActionResult } from "./usePlay";

const VenueMap = lazy(() => import("./VenueMap"));

/* Anyone can add a venue; it is usable straight away and shown as unverified until an admin approves,
   edits or merges it. Adding is: search or drop a pin, name it, save. Near-duplicates are suggested
   first so the same hall does not appear twice. */

type Found = { lat: string; lon: string; name?: string; display_name: string };

export default function VenueSheet({ data, act, onClose, onAdded }: {
  data: Dashboard; act: (action: string, values?: Record<string, unknown>) => Promise<ActionResult>;
  onClose: () => void; onAdded: (id: string) => void;
}) {
  const t = useT();
  const centre = cityById(data.city)?.center ?? { lat: 22.3193, lng: 114.1694 };
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState(centre);
  const [pinned, setPinned] = useState(false);
  const [duplicates, setDuplicates] = useState<PlayVenue[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      // Rare, user-initiated lookups only (submit, never as-you-type): within the public service's 1 request/second limit.
      const params = new URLSearchParams({ format: "jsonv2", limit: "5", q: query.trim() });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { accept: "application/json" } });
      setFound(response.ok ? ((await response.json()) as Found[]) : []);
      if (!response.ok) setError(t("暫時無法搜尋，請直接在地圖上點選位置。"));
    } catch { setError(t("暫時無法搜尋，請直接在地圖上點選位置。")); }
    setSearching(false);
  }

  function choose(item: Found) {
    setPin({ lat: Number(item.lat), lng: Number(item.lon) });
    setPinned(true);
    setFound([]);
    if (!name) setName((item.name || item.display_name.split(",")[0]).slice(0, 60));
  }

  async function save(confirmNew = false) {
    setPending(true);
    setError("");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = await act("venue.create", { name, nameEn, lat: pin.lat, lng: pin.lng, tz: zone, confirmNew });
    setPending(false);
    if (!result.ok) { setError(result.error ?? t("未能新增場地。")); return; }
    if (result.duplicates?.length) { setDuplicates(result.duplicates); return; }
    if (result.id) { onAdded(result.id); onClose(); }
  }

  return (
    <Sheet open title={t("新增場地")} onClose={onClose} className="play-sheet">
      <div className="play-form">
        <form className="play-search" onSubmit={(e) => void search(e)}>
          <FormField label={t("搜尋地址或場地")}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("例如：灣仔 桌球")} /></FormField>
          <Button type="submit" variant="secondary" loading={searching}>{t("搜尋")}</Button>
        </form>
        {found.length > 0 && <ul className="play-picker-list">{found.map((f, i) => <li key={`${f.lat},${f.lon},${i}`}><button type="button" onClick={() => choose(f)}><span>{f.display_name}</span></button></li>)}</ul>}

        <p className="play-hint">{t("在地圖上點選，或拖動標記，標示場地位置。")}</p>
        <Suspense fallback={<Skeleton height="14rem" />}>
          <VenueMap lat={pin.lat} lng={pin.lng} editable label={name || t("新場地")} zoom={pinned ? 16 : 11} onChange={(lat, lng) => { setPin({ lat, lng }); setPinned(true); }} />
        </Suspense>

        <FormField label={t("場地名稱")}><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label={t("英文名稱（選填）")}><input value={nameEn} maxLength={60} onChange={(e) => setNameEn(e.target.value)} /></FormField>

        {duplicates.length > 0 && (
          <InlineNotice tone="warning" title={t("會否是其中一間？")}>
            <ul className="play-picker-list">{duplicates.map((v) => <li key={v.id}><button type="button" onClick={() => { onAdded(v.id); onClose(); }}><span>{v.name}</span></button></li>)}</ul>
            <Button type="button" variant="secondary" onClick={() => void save(true)}>{t("不是，新增一間")}</Button>
          </InlineNotice>
        )}
        {error && <InlineNotice tone="danger" title={t("未能新增")}>{error}</InlineNotice>}
        <div className="play-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t("取消")}</Button>
          <Button type="button" loading={pending} disabled={!name.trim() || !pinned} onClick={() => void save()}>{t("新增")}</Button>
        </div>
        <p className="play-meta">{t("新場地可即時使用，管理員核實後會移除「未核實」標記。")}</p>
      </div>
    </Sheet>
  );
}
