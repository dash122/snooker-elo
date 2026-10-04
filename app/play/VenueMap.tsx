"use client";
import { useEffect, useRef } from "react";
import { Map as MapLibreMap, Marker, setWorkerUrl, type MapMouseEvent } from "maplibre-gl";
// MapLibre 6 ships its worker as a separate module. Bundlers have to be told where it ended up, with its
// imports bundled in, or the map draws a pin on a blank canvas.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useT } from "../components/I18nProvider";

/* Shows where a venue is: a map with one pin, nothing else (no routing, no directions). In edit mode
   the pin can be dragged, or the map clicked, to set the location when adding a venue.
   Tiles come from OpenFreeMap, which needs no key; its attribution control stays visible. */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
setWorkerUrl(workerUrl);

export default function VenueMap({ lat, lng, editable = false, onChange, label, zoom = 15 }: {
  lat: number; lng: number; editable?: boolean; onChange?: (lat: number, lng: number) => void; label: string; zoom?: number;
}) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; });

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current, style: STYLE, center: [lng, lat], zoom,
      attributionControl: { compact: true }, cooperativeGestures: true,
    });
    const pin = new Marker({ draggable: editable }).setLngLat([lng, lat]).addTo(instance);
    if (editable) {
      pin.on("dragend", () => { const p = pin.getLngLat(); change.current?.(p.lat, p.lng); });
      instance.on("click", (event: MapMouseEvent) => { pin.setLngLat(event.lngLat); change.current?.(event.lngLat.lat, event.lngLat.lng); });
    }
    map.current = instance;
    marker.current = pin;
    return () => { instance.remove(); map.current = null; marker.current = null; };
    // The map is created once per mount; later coordinates are applied below without rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, zoom]);

  useEffect(() => {
    marker.current?.setLngLat([lng, lat]);
    map.current?.easeTo({ center: [lng, lat], duration: 400 });
  }, [lat, lng]);

  return <div ref={container} className="play-map" role="img" aria-label={`${t("地圖")}：${label}`} />;
}
