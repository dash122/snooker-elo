// Shared between the account API routes and the client form so both agree on
// what counts as valid. Each returns an error code, or null when the value is
// acceptable; the client maps the codes to Chinese messages.
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,24}$/i;
export const MIN_PASSWORD = 8;
export const MAX_AVATAR_CHARS = 200_000; // ~150 KB of base64
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function checkUsername(value: string) {
  return USERNAME_PATTERN.test(value.trim()) ? null : "username-format";
}

export function checkEmail(value: string) {
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "email-format";
}

export function checkDisplayName(value: string) {
  const name = value.trim();
  return name.length >= 1 && name.length <= 40 ? null : "display-name-format";
}

export function checkPassword(value: string) {
  return value.length >= MIN_PASSWORD ? null : "password-short";
}

// Rough strength estimate for the signup meter: length plus character-class
// variety, not a full entropy calculation — good enough to nudge people away
// from "password1" without pulling in a scoring library.
export function passwordStrength(value: string): 0 | 1 | 2 | 3 | 4 {
  if (!value) return 0;
  let variety = 0;
  if (/[a-z]/.test(value)) variety++;
  if (/[A-Z]/.test(value)) variety++;
  if (/[0-9]/.test(value)) variety++;
  if (/[^A-Za-z0-9]/.test(value)) variety++;
  let score = 0;
  if (value.length >= MIN_PASSWORD) score++;
  if (value.length >= 12) score++;
  if (variety >= 2) score++;
  if (variety >= 3 && value.length >= 10) score++;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}

export function checkAvatar(value: string | null) {
  if (!value) return null;
  if (value.length > MAX_AVATAR_CHARS) return "avatar-large";
  return AVATAR_PATTERN.test(value) ? null : "avatar-format";
}

const INITIALS_PATTERN = /^[A-Z]{1,3}$/;

export function checkInitials(value: string | null) {
  if (!value) return null;
  return INITIALS_PATTERN.test(value) ? null : "initials-format";
}

// Default shown when a member hasn't picked their own initials: one letter
// per name segment (space or hyphen separated), e.g. "Dash Chan" -> "DC".
export function deriveInitials(name: string) {
  const letters = name.trim().split(/[\s-]+/).filter(Boolean).map(part => part[0]).join("").toUpperCase();
  return letters.slice(0, 3) || "?";
}

// A member and their linked player are the same person, so the player's name
// is the canonical display name once a link exists — the member row only
// carries its own displayName for accounts that aren't linked yet. Every
// place that shows a name or falls back to derived initials should call
// through here rather than picking one field or the other ad hoc.
export function resolveDisplayName(member: { displayName: string }, player?: { name: string } | null) {
  return player?.name ?? member.displayName;
}

export function resolveInitials(member: { initials?: string | null; displayName: string }, player?: { name: string } | null) {
  return member.initials || deriveInitials(resolveDisplayName(member, player));
}
