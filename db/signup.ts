import { createMemberWithPlayer, createSession, hasMembers } from "./auth";
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
    player: { id: playerId, name: displayName, short, colour: "#52796f", rating: initialRating, initialRating },
    auditText: `會員註冊並建立球員：${displayName}`,
  });

  return { cookie: await createSession(input.email), firstAccount, playerId };
}
