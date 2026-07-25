import { createMember, createSession, hasMembers } from "./auth";
import { getState, putState } from "./state";

type SharedState = {
  players?: unknown[];
  matches?: unknown[];
  settings?: { start?: number };
  audits?: unknown[];
  [key: string]: unknown;
};

export async function signUpMember(input: {
  username: string;
  email: string;
  displayName: string;
  password: string;
}) {
  const existing = await getState();
  const state: SharedState = existing ? JSON.parse(existing) : {
    players: [],
    matches: [],
    settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200, curvature: 1.25, handicapSoftCap: 800, winnerBonus: .5, overHandicapBoost: .75, overHandicapScale: 200, modelVersion: 3 },
    audits: [],
  };
  const playerId = crypto.randomUUID();
  const now = new Date().toISOString();
  const initialRating = Number(state.settings?.start ?? 1500);
  const short = Array.from(input.displayName.trim()).slice(0, 3).join("").toUpperCase();
  const player = {
    id: playerId,
    name: input.displayName.trim(),
    short,
    colour: "#52796f",
    handicap: null,
    rating: initialRating,
    initialRating,
    active: true,
    wins: 0,
    losses: 0,
    draws: 0,
    framesWon: 0,
    framesLost: 0,
    lastChange: 0,
    form: [],
  };

  const firstAccount = !(await hasMembers());
  await createMember(
    input.username,
    input.email,
    input.displayName,
    input.password,
    firstAccount ? "admin" : "member",
    playerId,
  );

  try {
    await putState(JSON.stringify({
      ...state,
      players: [...(state.players ?? []), player],
      matches: state.matches ?? [],
      audits: [
        { id: crypto.randomUUID(), text: `會員註冊並建立球員：${player.name}`, at: now },
        ...(state.audits ?? []),
      ],
    }));
  } catch (error) {
    // Account creation succeeded but shared-state persistence failed. Surface the
    // failure rather than issuing a session for a profile that is not yet usable.
    throw error;
  }

  return { cookie: await createSession(input.email), firstAccount, playerId };
}
