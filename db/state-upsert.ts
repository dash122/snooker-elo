import type { Sql } from "postgres";

type StateTable = "state_players" | "state_matches" | "state_tournaments" | "state_audits";

/** Compare only supplied writable columns; optional migration-owned columns can be absent. */
export function changedStateUpsert(sql: Sql, table: StateTable, rows: Record<string, unknown>[]) {
  const columns = Object.keys(rows[0]);
  // These identifiers come from server-owned row mappings, never payload keys.
  if (!columns.every(column => /^[a-z_][a-z_0-9]*$/.test(column))) throw new Error("Invalid state column");
  const writable = columns.filter(column => column !== "id" && !(table === "state_matches" && column === "created_at"));
  const compared = writable.filter(column => column !== "updated_at");
  const assignments = writable.map(column => `"${column}"=excluded."${column}"`).join(",");
  const current = compared.map(column => `"${table}"."${column}"`).join(",");
  const next = compared.map(column => `excluded."${column}"`).join(",");
  return sql`INSERT INTO ${sql(table)} ${sql(rows)} ON CONFLICT (id) DO UPDATE
    SET ${sql.unsafe(assignments)}
    WHERE ROW(${sql.unsafe(current)}) IS DISTINCT FROM ROW(${sql.unsafe(next)})`;
}
