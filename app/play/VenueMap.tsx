"use client";
import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useT } from "../components/I18nProvider";
import { InlineNotice } from "../components/ui/Primitives";
import { watchMapHealth } from "./map-health";

/* Shows where a venue is: a map with one pin, nothing else (no routing, no directions). In edit mode
   the pin can be dragged, or the map clicked, to set the location when adding a venue.
   Tiles come from OpenFreeMap, which needs no key; its attribution control stays visible. */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
// MapLibre 5 initializes its embedded worker in both Next.js and Vite builds.

export default function VenueMap({ lat, lng, editable = false, onChange, label, zoom = 15 }: {
  lat: number; lng: number; editable?: boolean; onChange?: (lat: number, lng: number) => void; label: string; zoom?: number;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; });

  useEffect(() => {
    if (!container.current) return;
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
      container: container.current, style: STYLE, center: [lng, lat], zoom,
      attributionControl: { compact: true }, cooperativeGestures: true,
    });
    } catch (error) {
      console.error("Venue map initialization failed", error);
      const timer = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(timer);
    }
    const stopWatching = watchMapHealth(instance, setFailed);
    const pin = new Marker({ draggable: editable }).setLngLat([lng, lat]).addTo(instance);
    if (editable) {
      pin.on("dragend", () => { const p = pin.getLngLat(); change.current?.(p.lat, p.lng); });
      instance.on("click", (event: MapMouseEvent) => { pin.setLngLat(event.lngLat); change.current?.(event.lngLat.lat, event.lngLat.lng); });
    }
    map.current = instance;
    marker.current = pin;
    return () => { stopWatching(); instance.remove(); map.current = null; marker.current = null; };
    // The map is created once per mount; later coordinates are applied below without rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, zoom]);

  useEffect(() => {
    marker.current?.setLngLat([lng, lat]);
    map.current?.easeTo({ center: [lng, lat], duration: 400 });
  }, [lat, lng]);

  return <>
    {failed && <InlineNotice tone="warning" title={t("地圖暫時無法載入")}>{t("請稍後重新開啟地圖。場地資料仍可使用。")}</InlineNotice>}
    <div ref={container} className="play-map" role="img" aria-label={`${t("地圖")}：${label}`} />
  </>;
}
