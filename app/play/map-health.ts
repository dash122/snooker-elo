import type { Map as MapLibreMap, ErrorEvent } from "maplibre-gl";

// Worker failures can leave DOM markers visible without ever completing the map load.
export function watchMapHealth(map: MapLibreMap, reportFailure: (failed: boolean) => void) {
  const reset = setTimeout(() => reportFailure(false), 0);
  const timer = setTimeout(() => {
    if (!map.loaded()) {
      console.error("Venue map did not finish loading within 20 seconds");
      reportFailure(true);
    }
  }, 20_000);
  const ready = () => { clearTimeout(timer); reportFailure(false); };
  const failed = (event: ErrorEvent) => {
    console.error("Venue map resource failed", event.error);
    reportFailure(true);
  };
  map.on("error", failed);
  map.on("load", ready);
  map.on("idle", ready);
  return () => {
    clearTimeout(reset);
    clearTimeout(timer);
    map.off("error", failed);
    map.off("load", ready);
    map.off("idle", ready);
  };
}
