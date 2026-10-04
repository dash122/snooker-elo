import type { Dashboard, LookingDto } from "./dashboard.ts";
import { dayRange } from "./time.ts";
import { overlaps } from "./window.ts";

/** Presentation only: keep server visibility rules intact, and add the viewer's own posts. */
export function marketplace(board: Dashboard, name: string, now = Date.now()) {
  const day = dayRange(board.date, board.tz);
  const sessions = board.sessions.filter((s) => s.city === board.city && overlaps(s, day) && Date.parse(s.endAt) > now && ["forming", "playable", "full"].includes(s.status))
    .sort((a, b) => Number(a.status === "full") - Number(b.status === "full"));
  const own = board.mine.filter((i) => i.city === board.city && i.status === "active" && Date.parse(i.endAt) > now && overlaps(i, day));
  const looking: (LookingDto & { own?: boolean; quiet?: boolean })[] = [
    ...own.map((i) => ({ ...i, player: { id: i.playerId, name, rating: board.viewerRating ?? 0 }, overlap: null, score: 0, why: [], own: true })),
    ...board.looking,
  ];
  return { sessions, looking };
}
