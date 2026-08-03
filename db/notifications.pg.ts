import { getSql } from "./sql";
import { sendPush, type PushSubscription } from "../lib/web-push";
import { sendNotificationEmail } from "../lib/mailer";
import type { NotificationChannel, NotificationMessage } from "../lib/notify";

export type StoredSubscription = PushSubscription & { playerId:string };
export type NotificationPrefs = {
  playerId:string; invites:boolean; openCalls:boolean; offers:boolean; results:boolean;
  emailFallback:boolean; quietFrom:number|null; quietTo:number|null;
};

let schemaReady:Promise<unknown>|null=null;
async function ensureSchema(){
  schemaReady??=(async()=>{
    const sql=getSql();
    /* Keyed by endpoint because that is what the browser guarantees unique — one member legitimately
       has several (phone, desktop, work laptop), and re-subscribing on the same device returns the
       same endpoint, so an upsert here replaces rather than accumulates. CASCADE rather than the
       RESTRICT used elsewhere: a subscription outliving its player is pure garbage, not history. */
    await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint text PRIMARY KEY,
      player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      p256dh text NOT NULL, auth text NOT NULL,
      user_agent text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      failure_count integer NOT NULL DEFAULT 0
    )`;
    await sql`CREATE INDEX IF NOT EXISTS push_subscriptions_player_idx ON push_subscriptions (player_id)`;
    await sql`CREATE TABLE IF NOT EXISTS notification_prefs (
      player_id text PRIMARY KEY REFERENCES state_players(id) ON DELETE CASCADE,
      invites boolean NOT NULL DEFAULT true,
      open_calls boolean NOT NULL DEFAULT true,
      offers boolean NOT NULL DEFAULT true,
      results boolean NOT NULL DEFAULT true,
      email_fallback boolean NOT NULL DEFAULT true,
      quiet_from smallint, quiet_to smallint,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

export async function saveSubscription(playerId:string,subscription:PushSubscription,userAgent:string){
  await ensureSchema(); const sql=getSql();
  await sql`INSERT INTO push_subscriptions (endpoint,player_id,p256dh,auth,user_agent)
    VALUES (${subscription.endpoint},${playerId},${subscription.p256dh},${subscription.auth},${userAgent.slice(0,300)})
    ON CONFLICT (endpoint) DO UPDATE SET player_id=EXCLUDED.player_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
      user_agent=EXCLUDED.user_agent,last_seen_at=now(),failure_count=0`;
}

export async function removeSubscription(endpoint:string){
  await ensureSchema(); const sql=getSql();
  await sql`DELETE FROM push_subscriptions WHERE endpoint=${endpoint}`;
}

export async function listSubscriptions(playerIds:string[]):Promise<StoredSubscription[]>{
  if(!playerIds.length)return [];
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT endpoint,player_id AS "playerId",p256dh,auth FROM push_subscriptions WHERE player_id IN ${sql(playerIds)}`;
  return rows.map(row=>({endpoint:row.endpoint,playerId:row.playerId,p256dh:row.p256dh,auth:row.auth}));
}

const DEFAULT_PREFS = {invites:true,openCalls:true,offers:true,results:true,emailFallback:true,quietFrom:null,quietTo:null};

export async function getPrefs(playerId:string):Promise<NotificationPrefs>{
  await ensureSchema(); const sql=getSql();
  const rows=await sql<any[]>`SELECT player_id AS "playerId",invites,open_calls AS "openCalls",offers,results,
    email_fallback AS "emailFallback",quiet_from AS "quietFrom",quiet_to AS "quietTo" FROM notification_prefs WHERE player_id=${playerId}`;
  return rows[0]??{playerId,...DEFAULT_PREFS};
}

export async function savePrefs(playerId:string,input:Partial<Omit<NotificationPrefs,"playerId">>){
  await ensureSchema(); const sql=getSql();
  const current=await getPrefs(playerId),next={...current,...input};
  await sql`INSERT INTO notification_prefs (player_id,invites,open_calls,offers,results,email_fallback,quiet_from,quiet_to)
    VALUES (${playerId},${next.invites},${next.openCalls},${next.offers},${next.results},${next.emailFallback},${next.quietFrom},${next.quietTo})
    ON CONFLICT (player_id) DO UPDATE SET invites=EXCLUDED.invites,open_calls=EXCLUDED.open_calls,offers=EXCLUDED.offers,
      results=EXCLUDED.results,email_fallback=EXCLUDED.email_fallback,quiet_from=EXCLUDED.quiet_from,quiet_to=EXCLUDED.quiet_to,updated_at=now()`;
  return next;
}

/** Prefs for many members at once, defaulted for anyone who never opened the settings — a member who
    has expressed no opinion should still be reachable, otherwise the feature only works for people
    who already went looking for it. */
async function prefsFor(playerIds:string[]):Promise<Map<string,NotificationPrefs>>{
  await ensureSchema(); const sql=getSql();
  const rows=playerIds.length?await sql<any[]>`SELECT player_id AS "playerId",invites,open_calls AS "openCalls",offers,results,
    email_fallback AS "emailFallback",quiet_from AS "quietFrom",quiet_to AS "quietTo" FROM notification_prefs WHERE player_id IN ${sql(playerIds)}`:[];
  const map=new Map(playerIds.map(id=>[id,{playerId:id,...DEFAULT_PREFS} as NotificationPrefs]));
  for(const row of rows)map.set(row.playerId,row);
  return map;
}

const CHANNEL_KEY:Record<NotificationChannel,keyof NotificationPrefs>={invite:"invites",openCall:"openCalls",offer:"offers",result:"results"};

/** Is it currently inside this member's quiet window, in Hong Kong hours? Wrapping ranges (22→9) are
    the normal case, so the comparison flips when `from` is later than `to`. */
function isQuiet(prefs:NotificationPrefs,now=new Date()){
  if(prefs.quietFrom===null||prefs.quietTo===null)return false;
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Hong_Kong",hour:"2-digit",hourCycle:"h23"}).format(now));
  return prefs.quietFrom<=prefs.quietTo?hour>=prefs.quietFrom&&hour<prefs.quietTo:hour>=prefs.quietFrom||hour<prefs.quietTo;
}

/** Fan one message out to every device a member has registered, falling back to email when push
 *  reached nothing.
 *
 *  Deliberately never throws and is never awaited on a request's critical path: a member must be able
 *  to send an invite from a phone on hotel wifi while the push service is having a bad day. Endpoints
 *  the service reports as permanently gone are pruned here, which is the only garbage collection
 *  these rows ever get. */
export async function notifyPlayers(playerIds:string[],message:NotificationMessage){
  const unique=[...new Set(playerIds)].filter(Boolean);
  if(!unique.length)return {sent:0,failed:0,skipped:0};
  try{
    const prefs=await prefsFor(unique);
    const allowed=unique.filter(id=>{const p=prefs.get(id)!;return p[CHANNEL_KEY[message.channel]]!==false&&!isQuiet(p)});
    const skipped=unique.length-allowed.length;
    if(!allowed.length)return {sent:0,failed:0,skipped};
    const subscriptions=await listSubscriptions(allowed);
    const reached=new Set<string>();
    let failed=0;
    await Promise.all(subscriptions.map(async subscription=>{
      const result=await sendPush(subscription,{
        title:message.title,body:message.body,tag:message.tag,url:message.url??"/?tab=availability",
      },{urgency:message.urgency??"normal",ttl:message.ttl});
      if(result.ok){reached.add(subscription.playerId);return}
      failed+=1;
      if(result.gone)await removeSubscription(subscription.endpoint).catch(()=>{});
    }));
    /* Email only for members push could not reach at all — a member with a working phone should not
       also get mail for every invite. */
    const unreached=allowed.filter(id=>!reached.has(id)&&prefs.get(id)!.emailFallback);
    if(unreached.length)await sendNotificationEmail(unreached,message).catch(()=>{});
    return {sent:reached.size,failed,skipped};
  }catch{
    return {sent:0,failed:0,skipped:unique.length};
  }
}

/** Member email addresses for the players who are due a fallback message. Lives here rather than in
    the mailer so the mailer stays transport-only and testable without a database. */
export async function emailsForPlayers(playerIds:string[]){
  if(!playerIds.length)return [];
  const sql=getSql();
  const rows=await sql<{email:string;displayName:string}[]>`SELECT email,display_name AS "displayName" FROM members
    WHERE state_player_id IN ${sql(playerIds)} AND active=true`;
  return rows;
}
