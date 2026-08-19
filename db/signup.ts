import { checkSignupAvailability, createMemberWithPlayer, createSession, hasMembers, resolveGoogleMember } from "./auth";
import { getState } from "./state";

export async function signUpMember(input: {
  username: string;
  email: string;
  displayName: string;
  password: string;
}) {
  const existing = await getState();
  const settings: { start?: number } | undefined = existing ? JSON.parse(existing).settings : undefined;
  const playerId = crypto.randomUUID();
  const initialRating = Number(settings?.start ?? 1500);
  const short = Array.from(input.displayName.trim()).slice(0, 3).join("").toUpperCase();
  const displayName = input.displayName.trim();

  const firstAccount = !(await hasMembers());

  // Player row and member row are written in one database transaction (see
  // createMemberWithPlayer), so a failure on either side leaves neither
  // behind — no more best-effort rollback of the player row.
  await createMemberWithPlayer({
    username: input.username,
    email: input.email,
    displayName: input.displayName,
    password: input.password,
    role: firstAccount ? "admin" : "member",
    player: { id: playerId, name: displayName, short, colour: "#52796f", rating: initialRating, initialRating, preliminaryRating: null },
    auditText: `會員註冊並建立球員：${displayName}`,
  });

  return { cookie: await createSession(input.email), firstAccount, playerId };
}
async function generateAvailableUsername(email: string) {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  const base = local.length >= 2 ? local.slice(0, 24) : "player";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    const { usernameTaken } = await checkSignupAvailability(candidate, null);
    if (!usernameTaken) return candidate;
  }
  return `${base}${crypto.randomUUID().slice(0, 6)}`;
}

async function signUpMemberViaGoogle(input: { email: string; displayName: string; googleId: string }) {
  const existing = await getState();
  const settings: { start?: number } | undefined = existing ? JSON.parse(existing).settings : undefined;
  const playerId = crypto.randomUUID();
  const initialRating = Number(settings?.start ?? 1500);
  const displayName = input.displayName.trim() || input.email.split("@")[0] || "Member";
  const short = Array.from(displayName).slice(0, 3).join("").toUpperCase();
  const username = await generateAvailableUsername(input.email);
  const firstAccount = !(await hasMembers());

  await createMemberWithPlayer({
    username,
    email: input.email,
    displayName,
    // Random and never surfaced — this account only ever signs in via Google.
    password: crypto.randomUUID() + crypto.randomUUID(),
    role: firstAccount ? "admin" : "member",
    player: { id: playerId, name: displayName, short, colour: "#52796f", rating: initialRating, initialRating },
    auditText: `Google 帳戶登入並建立球員：${displayName}`,
    googleId: input.googleId,
  });

  return { email: input.email.trim().toLowerCase() };
}

export type GoogleSignInResult =
  | { status: "linked" | "created"; email: string }
  | { status: "deactivated" };

// Resolves a Google sign-in to a member, creating one (with a linked player,
// same defaults as manual signup) on first use. Handles losing a create race
// against a concurrent request for the same email or generated username.
export async function signInOrSignUpWithGoogle(input: { email: string; displayName: string; googleId: string }): Promise<GoogleSignInResult> {
  const lookup = await resolveGoogleMember(input.email, input.googleId);
  if (lookup.status === "linked") return { status: "linked", email: lookup.email };
  if (lookup.status === "deactivated") return { status: "deactivated" };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await signUpMemberViaGoogle(input);
      return { status: "created", email: created.email };
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "23505") throw error;
      const recheck = await resolveGoogleMember(input.email, input.googleId);
      if (recheck.status === "linked") return { status: "linked", email: recheck.email };
      if (recheck.status === "deactivated") return { status: "deactivated" };
    }
  }
  throw new Error("signInOrSignUpWithGoogle: repeated collisions creating member");
}