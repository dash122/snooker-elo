import { env } from "cloudflare:workers";

const initialState = () => ({
  players: [],
  matches: [],
  settings: { start: 1500, provisionalGames: 10, kProvisional: 40, kRated: 24, conversion: 8, cap: 200 },
  audits: [{ id: crypto.randomUUID(), text: "清除並重設所有資料", at: new Date().toISOString() }],
});
const initial = JSON.stringify(initialState());

async function ensure() {
  const db = env.DB;
  if (!db) throw new Error("DB unavailable");
  await db.prepare("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("INSERT OR IGNORE INTO app_state (id, data, updated_at) VALUES (1, ?, ?)").bind(initial,new Date().toISOString()).run();
  return db;
}

export async function GET() {
  try {
    const db=await ensure();
    const row=await db.prepare("SELECT data FROM app_state WHERE id = 1").first<{data:string}>();
    return Response.json(row?JSON.parse(row.data):null);
  } catch { return Response.json({error:"storage unavailable"},{status:503}); }
}

export async function PUT(request:Request) {
  try {
    const body=await request.json();
    if(!body || !Array.isArray(body.players) || !Array.isArray(body.matches)) return Response.json({error:"invalid"},{status:400});
    const db=await ensure();
    await db.prepare("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1").bind(JSON.stringify(body),new Date().toISOString()).run();
    return Response.json({ok:true});
  } catch { return Response.json({error:"save failed"},{status:500}); }
}

export async function DELETE() {
  try {
    const db=await ensure();
    const fresh=initialState();
    await db.prepare("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1").bind(JSON.stringify(fresh),new Date().toISOString()).run();
    return Response.json(fresh);
  } catch { return Response.json({error:"reset failed"},{status:500}); }
}
