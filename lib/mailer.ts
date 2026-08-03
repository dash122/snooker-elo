import type { NotificationMessage } from "./notify";

/** Email fallback for members whose devices push cannot reach — an iPhone that never installed the
 *  PWA, a desktop that revoked permission, a brand-new member who has not been asked yet.
 *
 *  Transport is chosen by whichever environment variable is set, and with none set every call is a
 *  no-op that reports `skipped`. That is deliberate: the club can deploy the whole matchmaking
 *  upgrade today and turn mail on later without touching code, and local development never
 *  accidentally emails real members. */

type Transport = {name:string;send:(to:string[],subject:string,text:string)=>Promise<boolean>};

function transport():Transport|null {
  const from=process.env.NOTIFY_EMAIL_FROM;
  if(process.env.RESEND_API_KEY&&from)return {
    name:"resend",
    async send(to,subject,text){
      const response=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{"authorization":`Bearer ${process.env.RESEND_API_KEY}`,"content-type":"application/json"},
        body:JSON.stringify({from,to,subject,text}),
      });
      return response.ok;
    },
  };
  /* An escape hatch for clubs already running their own mail or chat relay (a Google Apps Script, a
     Slack/Telegram bridge): POST the same shape and do whatever you like with it. */
  if(process.env.NOTIFY_WEBHOOK_URL)return {
    name:"webhook",
    async send(to,subject,text){
      const response=await fetch(process.env.NOTIFY_WEBHOOK_URL!,{
        method:"POST",
        headers:{"content-type":"application/json",...(process.env.NOTIFY_WEBHOOK_TOKEN?{authorization:`Bearer ${process.env.NOTIFY_WEBHOOK_TOKEN}`}:{})},
        body:JSON.stringify({to,subject,text}),
      });
      return response.ok;
    },
  };
  return null;
}

export function mailerConfigured(){ return transport()!==null; }

const siteUrl=()=>process.env.NEXT_PUBLIC_SITE_URL||process.env.SITE_URL||"";

/** Send one composed notification to a set of players by id. Import is deferred so this module stays
    free of a database dependency for tests and so a deployment without Postgres can still typecheck. */
export async function sendNotificationEmail(playerIds:string[],message:NotificationMessage){
  const active=transport();
  if(!active||!playerIds.length)return {sent:0,transport:null};
  const {emailsForPlayers}=await import("../db/notifications.pg");
  const recipients=await emailsForPlayers(playerIds);
  if(!recipients.length)return {sent:0,transport:active.name};
  const link=siteUrl()?`\n\n開啟約戰：${siteUrl()}${message.url??"/?tab=availability"}`:"";
  const body=`${message.body}${link}\n\n—\nSCAA Snooker ELO。如不想再收到這類電郵，可在應用程式的通知設定關閉。`;
  const ok=await active.send(recipients.map(row=>row.email),message.title,body);
  return {sent:ok?recipients.length:0,transport:active.name};
}
