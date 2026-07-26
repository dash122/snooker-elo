// Shared between the account API routes and the client form so both agree on
// what counts as valid. Each returns an error code, or null when the value is
// acceptable; the client maps the codes to Chinese messages.
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,24}$/i;
export const MIN_PASSWORD = 6;
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
