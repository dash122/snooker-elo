import type { Dashboard } from "../../lib/play/dashboard.ts";

// Private responses stay in memory, scoped to the linked player and locale.
export function createBoardCache(ttl = 30_000) {
  const entries = new Map<string, { board: Dashboard; at: number }>();
  const pending = new Map<string, Promise<Dashboard>>();
  let generation = 0;
  return {
    peek(key: string) { return entries.get(key)?.board ?? null; },
    clear() { generation++; entries.clear(); pending.clear(); },
    load(key: string, fetchBoard: () => Promise<Dashboard>, force = false): Promise<Dashboard> {
      const hit = entries.get(key);
      if (!force && hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.board);
      const running = pending.get(key);
      if (running) return running;
      const version = generation;
      const request = Promise.resolve().then(fetchBoard).then((board) => {
        if (version === generation) entries.set(key, { board, at: Date.now() });
        return board;
      }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
      pending.set(key, request);
      return request;
    },
  };
}
