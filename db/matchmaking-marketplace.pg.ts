import {getSql} from "./sql.ts";
import {notifyPlayers} from "./notifications.pg";
import {marketplaceNotification} from "../lib/notify";
import {canJoin,marketplaceDeliveryTimingValid,type MarketplaceDeliveryKind} from "../lib/matchmaking-marketplace.ts";
import {marketplaceReady, readPool, type MarketConnection, type MarketDatabase} from "./matchmaking-marketplace-store.ts";

function connection(sql:ReturnType<typeof getSql>):MarketConnection {
  return {query:async<T>(text:string,params:unknown[]=[])=>Array.from(await sql.unsafe(text,params as never[])) as T[]};
}
export function marketplaceDatabase():MarketDatabase {
  const sql=getSql();
  return {...connection(sql),transaction:async<T>(fn:(db:MarketConnection)=>Promise<T>):Promise<T>=>
    sql.begin(tx=>fn(connection(tx as unknown as ReturnType<typeof getSql>))) as Promise<T>};
}
export async function isMarketplaceReady() {
  if(process.env.MATCHMAKING_MARKETPLACE_DISABLED==="true")return false;
  return marketplaceReady(marketplaceDatabase());
}

/** Bounded write-triggered delivery, with leased claims and retries on later requests. */
export async function deliverMarketplaceNotifications() {
  const db=marketplaceDatabase();
  if(!await isMarketplaceReady())return {claimed:0,sent:0,invalid:0,skipped:0};
  // Timed messages need no dedicated scheduler: ordinary marketplace traffic advances them.
  await db.query(`INSERT INTO matchmaking_delivery(id,session_id,player_id,kind,revision)
    SELECT s.id||':'||m.player_id||':'||kind,s.id,m.player_id,kind,0
    FROM matchmaking_sessions s JOIN matchmaking_session_members m ON m.session_id=s.id AND m.status='accepted'
    CROSS JOIN LATERAL (SELECT CASE WHEN s.end_at<=now() THEN 'result' ELSE 'reminder' END AS kind) k
    WHERE s.source<>'legacy' AND ((s.status IN ('playable','full') AND s.start_at>now() AND s.start_at<=now()+interval '1 hour')
      OR (s.status IN ('playable','full','completed') AND s.end_at<=now() AND s.end_at>now()-interval '1 day'))
    ON CONFLICT DO NOTHING`);
  const jobs=await db.transaction(async tx=>tx.query<{id:string;sessionId:string;playerId:string;kind:MarketplaceDeliveryKind;revision:number}>(`WITH candidates AS (
      SELECT id FROM matchmaking_delivery WHERE sent_at IS NULL AND next_attempt_at<=now() AND attempts<5 ORDER BY created_at LIMIT 8 FOR UPDATE SKIP LOCKED
    ) UPDATE matchmaking_delivery d SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' FROM candidates c WHERE d.id=c.id
      RETURNING d.id,d.session_id AS "sessionId",d.player_id AS "playerId",d.kind,d.revision`));
  if(!jobs.length)return {claimed:0,sent:0,invalid:0,skipped:0};
  const pool=await readPool(db,Date.now()-18*3600000);
  let sent=0,invalid=0,skipped=0;
  for(const job of jobs){
    const s=pool.sessions.find(s=>s.id===job.sessionId),m=s?.members.find(m=>m.playerId===job.playerId);
    const timingValid=Boolean(s&&marketplaceDeliveryTimingValid(job.kind,s));
    const valid=timingValid&&s&&((job.kind==="invite"&&m?.status==="pending")
      ||(job.kind==="recruit"&&pool.slots.some(a=>a.playerId===job.playerId&&!a.cancelled&&a.commitment==="going"&&Date.parse(a.endAt)>Date.now()&&canJoin(a,s,pool)))
      ||(job.kind==="playable"&&m?.status==="accepted"&&["playable","full"].includes(s.status))
      ||(job.kind==="reminder"&&m?.status==="accepted"&&["playable","full"].includes(s.status))
      ||(job.kind==="result"&&m?.status==="accepted"&&["playable","full","completed"].includes(s.status))
      ||(job.kind==="reopened"&&m?.status==="accepted"&&s.status==="forming"));
    if(!valid){invalid++;await db.query(`UPDATE matchmaking_delivery SET sent_at=now() WHERE id=$1`,[job.id]);continue;}
    const outcome=await notifyPlayers([job.playerId],marketplaceNotification(job.kind,s,pool.venues.find(v=>v.id===s.venueId)?.name??null));
    if(outcome.sent){sent+=outcome.sent;await db.query(`UPDATE matchmaking_delivery SET sent_at=now() WHERE id=$1`,[job.id]);}
    else skipped++;
  }
  return {claimed:jobs.length,sent,invalid,skipped};
}
