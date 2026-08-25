import { getSql } from "./sql";
import { sendNotificationEmail } from "../lib/mailer";
import type { NotificationMessage } from "../lib/notify";

/** Fan one message out to every player in the list, by email.
 *
 *  Push notifications and per-member preferences (channel toggles, quiet hours) used to sit in front
 *  of this -- both removed along with the `通知設定` tab, so every notification now simply emails
 *  everyone it names. `sendNotificationEmail` is itself a no-op when no mail transport is configured
 *  (see `lib/mailer.ts`), which is what a deployment without `RESEND_API_KEY`/`NOTIFY_WEBHOOK_URL`
 *  set actually gets: every call below returns `skipped` rather than sending anything. */
export async function notifyPlayers(playerIds:string[],message:NotificationMessage){
  const unique=[...new Set(playerIds)].filter(Boolean);
  if(!unique.length)return {sent:0,failed:0,skipped:0};
  try{
    const {sent}=await sendNotificationEmail(unique,message);
    return {sent,failed:0,skipped:unique.length-sent};
  }catch{
    return {sent:0,failed:0,skipped:unique.length};
  }
}

export async function emailsForPlayers(playerIds:string[]){
  if(!playerIds.length)return [];
  const sql=getSql();
  const rows=await sql<{email:string;displayName:string}[]>`SELECT email,display_name AS "displayName" FROM members
    WHERE state_player_id IN ${sql(playerIds)} AND active=true`;
  return rows;
}
