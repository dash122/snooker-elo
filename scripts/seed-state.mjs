// One-off: push exported match data (JSON) into the app_state table on
// whatever Postgres POSTGRES_URL/DATABASE_URL points at.
//
// Usage: POSTGRES_URL=postgres://... node scripts/seed-state.mjs path/to/state.json
import { readFileSync } from "node:fs";
import postgres from "postgres";

const [, , file] = process.argv;
if (!file) {
  console.error("Usage: node scripts/seed-state.mjs path/to/state.json");
  process.exit(1);
}

const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Set POSTGRES_URL (or DATABASE_URL / SUPABASE_DB_URL) first.");
  process.exit(1);
}

const data = readFileSync(file, "utf-8");
JSON.parse(data); // validate

const sql = postgres(url, { ssl: "require", prepare: false });
await sql`
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;
const now = new Date().toISOString();
await sql`
  INSERT INTO app_state (id, data, updated_at) VALUES (1, ${data}, ${now})
  ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`;
console.log("Seeded app_state.");
await sql.end();
