import postgres from "postgres";
import { mergeIntervals, type AvailabilitySlot } from "../lib/availability";

export type AvailabilityMember = { id:string; name:string; short:string; rating:number; colour?:string|null; avatar?:string|null; slots:AvailabilitySlot[] };

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (!sqlClient) {
    const url=process.env.POSTGRES_URL||process.env.DATABASE_URL||process.env.SUPABASE_DB_URL;
    if(!url)throw new Error("No Postgres connection string found. Set POSTGRES_URL.");
    sqlClient=postgres(url,{ssl:"require",prepare:false});
  }
  return sqlClient;
}

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  schemaReady??=(async()=>{
    const sql=getSql();
    await sql`CREATE TABLE IF NOT EXISTS availability_slots (
      id text PRIMARY KEY, player_id text NOT NULL REFERENCES state_players(id) ON DELETE RESTRICT,
      start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
      CHECK (end_at > start_at)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS availability_slots_active_range_idx ON availability_slots (start_at, end_at) WHERE cancelled_at IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS availability_slots_player_active_idx ON availability_slots (player_id, start_at) WHERE cancelled_at IS NULL`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

function slot(row:any):AvailabilitySlot { return {id:row.id,playerId:row.playerId,startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),createdAt:new Date(row.createdAt).toISOString(),updatedAt:new Date(row.updatedAt).toISOString(),cancelledAt:row.cancelledAt?new Date(row.cancelledAt).toISOString():null}; }

export async function listAvailability(startAt:string,endAt:string){
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT p.id AS "playerId",p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar,s.id,s.start_at AS "startAt",s.end_at AS "endAt",s.created_at AS "createdAt",s.updated_at AS "updatedAt",s.cancelled_at AS "cancelledAt"
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.cancelled_at IS NULL AND s.end_at > now() AND s.start_at < ${endAt} AND s.end_at > ${startAt} AND p.active=true
    ORDER BY p.name,s.start_at`;
  const grouped=new Map<string,AvailabilityMember>();
  for(const row of rows){const current:AvailabilityMember=grouped.get(row.playerId)??{id:row.playerId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar,slots:[]};current.slots.push(slot({...row,playerId:row.playerId}));grouped.set(row.playerId,current);}
  return [...grouped.values()];
}

export async function listOwnAvailability(playerId:string){
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt" FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() ORDER BY start_at`;
  return rows.map(slot);
}

export async function publishAvailability(playerId:string,items:{startAt:string;endAt:string}[]){
  await ensureSchema(); const sql=getSql();
  return sql.begin(async tx=>{
    const existing=await tx<any[]>`SELECT id,start_at AS "startAt",end_at AS "endAt" FROM availability_slots WHERE player_id=${playerId} AND cancelled_at IS NULL AND end_at > now()`;
    const candidates=existing.filter(row=>items.some(item=>Date.parse(row.startAt)<=Date.parse(item.endAt)&&Date.parse(row.endAt)>=Date.parse(item.startAt)));
    const merged=mergeIntervals([...items,...candidates.map(row=>({startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString()}))]);
    if(candidates.length)await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id IN ${tx(candidates.map(row=>row.id))}`;
    const saved:AvailabilitySlot[]=[];
    for(const item of merged){const id=crypto.randomUUID();const rows=await tx<any[]>`INSERT INTO availability_slots (id,player_id,start_at,end_at) VALUES (${id},${playerId},${item.startAt},${item.endAt}) RETURNING id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt"`;saved.push(slot(rows[0]));}
    return saved;
  });
}
export async function updateAvailability(id:string,playerId:string,item:{startAt:string;endAt:string}){
  await ensureSchema();const sql=getSql();
  const rows=await sql<any[]>`UPDATE availability_slots SET start_at=${item.startAt},end_at=${item.endAt},updated_at=now() WHERE id=${id} AND player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() RETURNING id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",created_at AS "createdAt",updated_at AS "updatedAt",cancelled_at AS "cancelledAt"`;
  return rows[0]?slot(rows[0]):null;
}

export async function cancelAvailability(id:string,playerId:string){
  await ensureSchema();const sql=getSql();
  const rows=await sql<any[]>`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id=${id} AND player_id=${playerId} AND cancelled_at IS NULL AND end_at > now() RETURNING id`;
  return Boolean(rows[0]);
}
