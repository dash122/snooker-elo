/**
 * Avatar colours. Every entry is dark enough to carry white initials, so a
 * player can pick any of them without the badge becoming unreadable. The first
 * is the original club green and stays the default for existing players.
 *
 * Kept out of UiBits so the account API routes can validate a submitted colour
 * on the server — UiBits is a "use client" module and cannot be imported there.
 */
export const AVATAR_COLOURS: { id: string; name: string; hex: string }[] = [
  { id: "green", name: "墨綠", hex: "#155e52" },
  { id: "forest", name: "森綠", hex: "#2c6b3f" },
  { id: "teal", name: "青碧", hex: "#12706b" },
  { id: "olive", name: "橄欖", hex: "#5f6b1f" },
  { id: "ocean", name: "海藍", hex: "#17628f" },
  { id: "navy", name: "深藍", hex: "#1e4f7a" },
  { id: "indigo", name: "靛藍", hex: "#3b4b9a" },
  { id: "violet", name: "紫羅蘭", hex: "#6a3d8f" },
  { id: "magenta", name: "洋紅", hex: "#97306b" },
  { id: "wine", name: "酒紅", hex: "#9c2f3f" },
  { id: "brick", name: "磚紅", hex: "#b04a2f" },
  { id: "amber", name: "琥珀", hex: "#a35a12" },
  { id: "bronze", name: "古銅", hex: "#8a6a12" },
  { id: "slate", name: "石板", hex: "#4a5a63" },
  { id: "ink", name: "墨黑", hex: "#333f46" },
];

export const DEFAULT_AVATAR = AVATAR_COLOURS[0].id;

export function avatarHex(colour?: string | null) {
  return AVATAR_COLOURS.find(option => option.id === colour)?.hex ?? AVATAR_COLOURS[0].hex;
}

export function avatarStyle(colour?: string | null) {
  return { background: avatarHex(colour) };
}

/** Error code when a member submits a colour that isn't in the palette. */
export function checkColour(value: string | null | undefined) {
  if (value == null || value === "") return null;
  return AVATAR_COLOURS.some(option => option.id === value) ? null : "colour-unknown";
}
