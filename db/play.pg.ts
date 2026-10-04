import { getSql } from "./sql.ts";
import { getStateDocument, getStateVersion, putState } from "./state.ts";
import { playReady, type PlayConnection, type PlayDatabase } from "./play-store.ts";
import type { StateGateway } from "./play-results.ts";

/* Adapters from the application's single Postgres pool to the injected interfaces the play
   repository is written against. Nothing here has logic: it exists so the repository can run
   unchanged against PGlite in tests. */

function connection(sql: ReturnType<typeof getSql>): PlayConnection {
  return { query: async <T>(text: string, params: unknown[] = []) => Array.from(await sql.unsafe(text, params as never[])) as T[] };
}

export function playDatabase(): PlayDatabase {
  const sql = getSql();
  return {
    ...connection(sql),
    transaction: async <T>(fn: (db: PlayConnection) => Promise<T>): Promise<T> =>
      sql.begin((tx) => fn(connection(tx as unknown as ReturnType<typeof getSql>))) as Promise<T>,
  };
}

/** `PLAY_DISABLED=true` is the kill switch; otherwise the feature is on once its tables exist. */
export async function isPlayReady() {
  if (process.env.PLAY_DISABLED === "true") return false;
  try { return await playReady(playDatabase()); } catch { return false; }
}

/** The club's rating state is one document guarded by a version. The version is re-read just before
    writing: if anyone saved in between, the write is refused and the caller recomputes. This narrows
    the window to a single round trip, which is the same guarantee the browser's `if-match` gives. */
export function stateGateway(): StateGateway {
  return {
    async read() {
      // One query returns the document and its version together, so they can never disagree.
      const { data, version } = await getStateDocument();
      return data ? { json: data, version } : null;
    },
    async write(json, version) {
      if ((await getStateVersion()) !== version) return false;
      await putState(json);
      return true;
    },
  };
}
