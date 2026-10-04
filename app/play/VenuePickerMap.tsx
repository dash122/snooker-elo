"use client";
import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useT } from "../components/I18nProvider";
import { InlineNotice } from "../components/ui/Primitives";
import { watchMapHealth } from "./map-health";

/* Every venue in the city as a pin; tap a pin to choose that venue, tap it again to clear. */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
// MapLibre 5 initializes its embedded worker in both Next.js and Vite builds.

type Pin = { id: string; name: string; lat: number; lng: number };

export default function VenuePickerMap({ venues, selected, onToggle, center }: {
  venues: Pin[]; selected: string[]; onToggle: (id: string) => void; center: { lat: number; lng: number };
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const toggle = useRef(onToggle);
  useEffect(() => { toggle.current = onToggle; });

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({ container: container.current, style: STYLE, center: [center.lng, center.lat], zoom: 10.5, attributionControl: { compact: true }, cooperativeGestures: true });
    } catch (error) {
      console.error("Venue map initialization failed", error);
      const timer = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(timer);
    }
    const stopWatching = watchMapHealth(map, setFailed);
    const list = markers.current;
    for (const v of venues) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "play-pin";
      el.title = v.name;
      el.setAttribute("aria-label", v.name);
      el.addEventListener("click", (event) => { event.stopPropagation(); toggle.current(v.id); });
      list.set(v.id, { marker: new Marker({ element: el }).setLngLat([v.lng, v.lat]).addTo(map), el });
    }
    if (venues.length > 1) {
      const bounds = new LngLatBounds();
      for (const v of venues) bounds.extend([v.lng, v.lat]);
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
    } else if (venues.length === 1) map.jumpTo({ center: [venues[0].lng, venues[0].lat], zoom: 14 });
    return () => { stopWatching(); map.remove(); list.clear(); };
    // Rebuilt only when the set of venues changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues.map((v) => v.id).join(","), center.lat, center.lng]);

  useEffect(() => {
    for (const [id, { el }] of markers.current) el.setAttribute("aria-pressed", String(selected.includes(id)));
  }, [selected, venues]);

  return <>
    {failed && <InlineNotice tone="warning" title={t("地圖暫時無法載入")}>{t("請稍後重新開啟地圖。場地資料仍可使用。")}</InlineNotice>}
    <div ref={container} className="play-map play-map--picker" role="group" aria-label={t("地圖")} />
  </>;
}
