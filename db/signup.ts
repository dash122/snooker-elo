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

  // The player row must exist before the member row, since members.state_player_id
  // has a foreign-key constraint against the players table.
  await putState(JSON.stringify({
    ...state,
    players: [...(state.players ?? []), player],
    matches: state.matches ?? [],
    audits: [
      { id: crypto.randomUUID(), text: `會員註冊並建立球員：${player.name}`, at: now },
      ...(state.audits ?? []),
    ],
  }));

  try {
    await createMember(
      input.username,
      input.email,
      input.displayName,
      input.password,
      firstAccount ? "admin" : "member",
      playerId,
    );
  } catch (error) {
    // Member creation failed (e.g. duplicate username/email) after the player
    // row was already written — remove it so signup can be retried cleanly.
    await putState(JSON.stringify({ ...state, players: state.players ?? [], matches: state.matches ?? [] })).catch(() => {});
    throw error;
  }

  return { cookie: await createSession(input.email), firstAccount, playerId };
}
