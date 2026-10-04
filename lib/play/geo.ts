/* The city is the market boundary: Hong Kong and London are separate boards, and a board's times are
   shown in its own zone. Cities are recognised from a venue's pin; a pin outside every known box
   becomes "other" and keeps whatever zone the person adding it was in, so a new city can appear
   before we have a name for it. */

export type City = { id: string; label: string; labelEn: string; tz: string; center: { lat: number; lng: number }; box: { south: number; north: number; west: number; east: number } };

export const CITIES: City[] = [
  { id: "hong-kong", label: "香港", labelEn: "Hong Kong", tz: "Asia/Hong_Kong", center: { lat: 22.3193, lng: 114.1694 }, box: { south: 22.13, north: 22.57, west: 113.82, east: 114.45 } },
  { id: "london", label: "倫敦", labelEn: "London", tz: "Europe/London", center: { lat: 51.5074, lng: -0.1278 }, box: { south: 51.28, north: 51.70, west: -0.52, east: 0.34 } },
];

export const OTHER_CITY = "other";

export function cityById(id: string) {
  return CITIES.find((c) => c.id === id) ?? null;
}

export function cityForPin(lat: number, lng: number, fallbackTz = "UTC"): { city: string; tz: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RangeError("Invalid coordinates");
  const hit = CITIES.find((c) => lat >= c.box.south && lat <= c.box.north && lng >= c.box.west && lng <= c.box.east);
  return hit ? { city: hit.id, tz: hit.tz } : { city: OTHER_CITY, tz: fallbackTz };
}

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres, used to suggest duplicates when a venue is added. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const normalise = (name: string) => name.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/** Existing venues that might be the one being added: a near-identical name, or any name within
    150 m. The member is shown these before a new venue is created. */
export function likelyDuplicates<T extends { name: string; nameEn?: string | null; lat: number | null; lng: number | null }>(
  candidate: { name: string; lat: number; lng: number }, existing: T[],
): T[] {
  const key = normalise(candidate.name);
  return existing.filter((v) => {
    const names = [v.name, v.nameEn ?? ""].map(normalise).filter(Boolean);
    const sameName = names.some((n) => n === key || (key.length >= 3 && (n.includes(key) || key.includes(n))));
    const near = v.lat != null && v.lng != null && distanceKm(candidate, { lat: v.lat, lng: v.lng }) <= 0.15;
    return sameName || near;
  });
}
