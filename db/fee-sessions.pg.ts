import { getSql } from "./sql";
import type { FeeEntry, FeeSession } from "../lib/fee-session";

/** 波鐘計數機 sessions: a standalone table-fee tally, independent of the players/matches state
 *  blob so an ordinary member can create and edit one without going through the state write-lock
 *  that guards ELO and match records. */

let schemaReady: Promise<unknown> | null = null;
export async function ensureFeeSessionSchema() { return ensureSchema(); }
async function ensureSchema() {
  schemaReady ??= (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS fee_sessions (
      id text PRIMARY KEY,
      title text NOT NULL DEFAULT '',
      entries jsonb NOT NULL DEFAULT '[]',
      created_by text NOT NULL,
      created_by_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS fee_sessions_created_at_idx ON fee_sessions (created_at DESC)`;
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

function row(r: any): FeeSession {
  return {
    id: r.id,
    title: r.title ?? "",
    entries: (r.entries ?? []) as FeeEntry[],
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

const columns = `id,title,entries,created_by AS "createdBy",created_by_name AS "createdByName",created_at AS "createdAt",updated_at AS "updatedAt"`;

export async function listFeeSessions(limit = 50): Promise<FeeSession[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<any[]>`SELECT ${sql.unsafe(columns)} FROM fee_sessions ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(row);
}

export async function getFeeSession(id: string): Promise<FeeSession | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<any[]>`SELECT ${sql.unsafe(columns)} FROM fee_sessions WHERE id = ${id}`;
  return rows[0] ? row(rows[0]) : null;
}

export async function createFeeSession(input: { title: string; entries: FeeEntry[]; createdBy: string; createdByName: string }): Promise<FeeSession> {
  await ensureSchema();
  const sql = getSql();
  const id = crypto.randomUUID();
  const rows = await sql<any[]>`INSERT INTO fee_sessions (id,title,entries,created_by,created_by_name)
    VALUES (${id},${input.title},${sql.json(input.entries)},${input.createdBy},${input.createdByName})
    RETURNING ${sql.unsafe(columns)}`;
  return row(rows[0]);
}

/** Only the creator or an admin may call this — enforced by the route, not here. */
export async function updateFeeSession(id: string, input: { title: string; entries: FeeEntry[] }): Promise<FeeSession | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<any[]>`UPDATE fee_sessions SET title=${input.title},entries=${sql.json(input.entries)},updated_at=now()
    WHERE id=${id} RETURNING ${sql.unsafe(columns)}`;
  return rows[0] ? row(rows[0]) : null;
}

export async function deleteFeeSession(id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`DELETE FROM fee_sessions WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
