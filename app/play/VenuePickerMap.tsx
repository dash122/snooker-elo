"use client";
import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useT } from "../components/I18nProvider";

/* Every venue in the city as a pin; tap a pin to choose that venue, tap it again to clear. */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
setWorkerUrl(workerUrl);

type Pin = { id: string; name: string; lat: number; lng: number };

export default function VenuePickerMap({ venues, selected, onToggle, center }: {
  venues: Pin[]; selected: string[]; onToggle: (id: string) => void; center: { lat: number; lng: number };
}) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const toggle = useRef(onToggle);
  useEffect(() => { toggle.current = onToggle; });

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({ container: container.current, style: STYLE, center: [center.lng, center.lat], zoom: 10.5, attributionControl: { compact: true }, cooperativeGestures: true });
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
    return () => { map.remove(); list.clear(); };
    // Rebuilt only when the set of venues changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues.map((v) => v.id).join(","), center.lat, center.lng]);

  useEffect(() => {
    for (const [id, { el }] of markers.current) el.setAttribute("aria-pressed", String(selected.includes(id)));
  }, [selected, venues]);

  return <div ref={container} className="play-map play-map--picker" role="group" aria-label={t("地圖")} />;
}
