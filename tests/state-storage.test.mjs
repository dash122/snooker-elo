import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import postgres from "postgres";
import { stringify } from "../node_modules/postgres/src/types.js";
import { PGlite } from "@electric-sql/pglite";

// Exercise the actual persistence functions and postgres.js SQL against an
// isolated PostgreSQL engine. The only substituted module is the connection.
const sqlModule = new URL("../db/sql.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
      const target = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(target)) return { url: target.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === sqlModule) return { format: "module", source: "export function getSql() { return globalThis.__stateStorageSql; }", shortCircuit: true };
    return next(url, context);
  },
});

const templateSql = postgres("postgres://unused:unused@127.0.0.1:5432/unused", { ssl: false });
const options = { transform: { undefined: null, column: {}, value: {}, row: {} } };
function adapter(client) {
  const run = query => {
    const params = [], types = [];
    const statement = stringify(query, query.strings[0], query.args[0], params, types, options);
    return client.query(statement, params).then(result => Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length }));
  };
  const sql = (...args) => {
    if (!Array.isArray(args[0]) || !Object.hasOwn(args[0], "raw")) return templateSql(...args);
    return run(templateSql(...args));
  };
  sql.json = templateSql.json;
  sql.unsafe = (...args) => {
    const query = templateSql.unsafe(...args);
    query.then = (resolve, reject) => run(query).then(resolve, reject);
    return query;
  };
  sql.begin = callback => client.transaction(tx => callback(adapter(tx)));
  return sql;
}

async function fixture() {
  const pg = new PGlite();
  const baseline = readFileSync(new URL("../supabase/migrations/20260810000000_baseline.sql", import.meta.url), "utf8");
  const tables = ["state_players", "state_matches", "state_tournaments", "state_settings", "state_audits", "app_state_snapshots", "app_state_snapshot_entities", "app_state_snapshot_items"];
  for (const table of tables) {
    const definition = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition, table);
    await pg.exec(definition[0]);
  }
  await pg.exec(`
    ALTER TABLE state_players ADD PRIMARY KEY(id);
    ALTER TABLE state_matches ADD PRIMARY KEY(id);
    ALTER TABLE state_tournaments ADD PRIMARY KEY(id);
    ALTER TABLE state_settings ADD PRIMARY KEY(id);
    ALTER TABLE state_audits ADD PRIMARY KEY(id);
    CREATE SEQUENCE app_state_snapshots_id_seq;
    ALTER TABLE app_state_snapshots ALTER COLUMN id SET DEFAULT nextval('app_state_snapshots_id_seq');
    ALTER TABLE app_state_snapshots ADD PRIMARY KEY(id);
    ALTER TABLE app_state_snapshot_entities ADD PRIMARY KEY(content_hash);
    ALTER TABLE app_state_snapshot_items ADD PRIMARY KEY(snapshot_id,entity_type,entity_id);
    ALTER TABLE app_state_snapshot_items ADD FOREIGN KEY(snapshot_id) REFERENCES app_state_snapshots(id) ON DELETE CASCADE;
    ALTER TABLE app_state_snapshot_items ADD FOREIGN KEY(content_hash) REFERENCES app_state_snapshot_entities(content_hash);
    CREATE INDEX app_state_snapshot_items_lookup_idx ON app_state_snapshot_items(snapshot_id,entity_type,position);
    ALTER TABLE state_matches ADD FOREIGN KEY(player_a) REFERENCES state_players(id) ON DELETE RESTRICT;
    ALTER TABLE state_matches ADD FOREIGN KEY(player_b) REFERENCES state_players(id) ON DELETE RESTRICT;
  `);
  for (const name of ["20260817000000_member_preliminary_rating", "20260817000001_provisional_match_deltas", "20260828000000_state_tournaments_updated_at", "20260901000000_tournament_co_hosts", "20260901010000_tournament_start_at", "20260901020000_tournament_arrival_times"]) {
    await pg.exec(readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  await pg.transaction(tx => tx.exec(readFileSync(new URL("../supabase/migrations/20261001111705_snapshot_storage_maintenance.sql", import.meta.url), "utf8")));
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('app_state_snapshot_items_content_hash_idx','app_state_snapshots_saved_at_idx')")).rows[0].n, 2);
  assert.ok((await pg.query("SELECT reloptions FROM pg_class WHERE relname='app_state_snapshot_items'")).rows[0].reloptions.includes("autovacuum_vacuum_scale_factor=0.05"));
  globalThis.__stateStorageSql = adapter(pg);
  return pg;
}

const player = id => ({ id, name: id, short: id, handicap: null, rating: 1500, initialRating: 1500, active: true, wins: 0, losses: 0, draws: 0, framesWon: 0, framesLost: 0, lastChange: 0, form: [] });
const initial = () => ({
  players: [player("a"), player("b")],
  matches: [{ id: "m", a: "a", b: "b", scoreA: 2, scoreB: 1, playedOn: "2026-09-30", actual: 1, giver: null, official: null, extra: 0, expectedA: 0.5, beforeA: 1500, beforeB: 1500, afterA: 1510, afterB: 1490, deltaA: 10, status: "confirmed", createdAt: "2026-09-30T12:00:00Z" }],
  tournaments: [{ id: "t", name: "秋季盃", handicapMode: "none", signupDeadline: "2026-10-05T18:00", createdAt: "2026-09-29T12:00:00Z", signups: ["a"] }],
  settings: { start: 1500 },
  audits: [{ id: "audit", text: "建立", at: "2026-09-30T12:00:00Z" }],
});

test("real state saves skip unchanged rows, preserve versions and retain fully restorable snapshots", async () => {
  const pg = await fixture();
  try {
    const { putState, getStateDocument, getStateVersion, restoreSnapshot } = await import("../db/state.pg.ts");
    const state = initial();
    await putState(JSON.stringify(state));
    const original = await getStateDocument();
    const [snapshot] = (await pg.query("SELECT id FROM app_state_snapshots")).rows;
    // Old sentinel timestamps reveal even an unnecessary UPDATE.
    await pg.exec("UPDATE state_players SET updated_at='2000-01-01'; UPDATE state_matches SET updated_at='2000-01-01'; UPDATE state_tournaments SET updated_at='2000-01-01'; UPDATE state_settings SET updated_at='2000-01-01'");
    const version = await getStateVersion();
    await putState(JSON.stringify(state));
    assert.equal(await getStateVersion(), version);
    for (const table of ["state_players", "state_matches", "state_tournaments", "state_settings"]) {
      assert.equal((await pg.query(`SELECT count(*)::int AS n FROM ${table} WHERE updated_at <> '2000-01-01'`)).rows[0].n, 0, table);
    }
    await pg.exec("UPDATE app_state_snapshots SET saved_at=now()-interval '2 hours'");
    await putState(JSON.stringify(state));
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM app_state_snapshots")).rows[0].n, 1, "identical eligible save creates no snapshot");
    state.players[0].avatar = "new.png";
    await putState(JSON.stringify(state));
    assert.notEqual(await getStateVersion(), version);
    assert.equal((await pg.query("SELECT updated_at='2000-01-01' AS unchanged FROM state_players WHERE id='b'")).rows[0].unchanged, true);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM app_state_snapshots")).rows[0].n, 2);
    const beforeFailedSave = await getStateVersion();
    await assert.rejects(putState(JSON.stringify({ ...state, matches: [{ ...state.matches[0], a: "missing-player" }] })), /foreign key/);
    assert.equal(await getStateVersion(), beforeFailedSave, "a failed save rolls back the whole transaction");
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM app_state_snapshots")).rows[0].n, 2);
    await restoreSnapshot(snapshot.id);
    assert.deepEqual(JSON.parse((await getStateDocument()).data), JSON.parse(original.data));

    const beforeAudit = await getStateVersion();
    state.players[0].avatar = null;
    state.audits[0].text = "修改相同時間的記錄";
    await putState(JSON.stringify(state));
    assert.notEqual(await getStateVersion(), beforeAudit, "audit edits advance the central version marker");
    const beforeDelete = await getStateVersion();
    state.matches = [];
    state.players = [state.players[0]];
    await putState(JSON.stringify(state));
    assert.notEqual(await getStateVersion(), beforeDelete, "deletions advance the version marker");
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM state_matches")).rows[0].n, 0);

    // Repeated independent snapshots share payloads; expiry removes only references
    // and truly orphaned payloads. Every retained snapshot must still restore.
    await pg.exec(`INSERT INTO app_state_snapshots(state,saved_at) SELECT NULL,now()-i*interval '1 day' FROM generate_series(1,100) i;
      INSERT INTO app_state_snapshot_items(snapshot_id,entity_type,entity_id,content_hash,position)
      SELECT s.id,i.entity_type,i.entity_id,i.content_hash,i.position FROM app_state_snapshots s CROSS JOIN app_state_snapshot_items i
      WHERE i.snapshot_id=${snapshot.id} AND s.id<>${snapshot.id}
      ON CONFLICT DO NOTHING;
      INSERT INTO app_state_snapshot_entities VALUES ('orphan','audit','deleted','{}');
      UPDATE app_state_snapshots SET saved_at=saved_at-interval '2 hours';`);
    await putState(JSON.stringify(state));
    const retained = (await pg.query("SELECT id FROM app_state_snapshots ORDER BY saved_at DESC")).rows;
    assert.ok(retained.length <= 46);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM app_state_snapshot_entities e WHERE NOT EXISTS (SELECT 1 FROM app_state_snapshot_items i WHERE i.content_hash=e.content_hash)")).rows[0].n, 0);
    for (const row of retained) {
      await restoreSnapshot(row.id);
      assert.ok(JSON.parse((await getStateDocument()).data).players.length > 0);
    }
    await assert.rejects(restoreSnapshot(-1), /snapshot not found/);
  } finally {
    delete globalThis.__stateStorageSql;
    hooks.deregister();
    await pg.close();
    await templateSql.end();
  }
});
