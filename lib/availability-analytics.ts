export type AvailabilityEvent =
  | "availability_view"
  | "availability_date_select"
  | "availability_composer_open"
  | "availability_slot_draft_add"
  | "availability_validation_error"
  | "availability_overnight_created"
  | "availability_slot_publish"
  | "availability_slot_edit"
  | "availability_slot_cancel"
  /* The funnel the redesign is judged on. Each step is the one before it plus an act of commitment,
     so the drop-off between any two names a specific piece of friction rather than a vague "people
     don't use matchmaking". */
  | "matchmaking_free_now"
  | "matchmaking_invite_open"
  | "matchmaking_invite_send"
  | "matchmaking_invite_accept"
  | "matchmaking_invite_decline"
  | "matchmaking_invite_counter"
  | "matchmaking_offer_shown"
  | "matchmaking_offer_yes"
  | "matchmaking_offer_no"
  | "matchmaking_offer_matched"
  | "matchmaking_open_call_post"
  | "matchmaking_open_call_claim"
  | "matchmaking_recurrence_add"
  | "matchmaking_recurrence_remove"
  | "matchmaking_copy_last_week"
  | "matchmaking_push_prompt_shown"
  | "matchmaking_push_enabled"
  | "matchmaking_push_dismissed"
  | "matchmaking_result_played"
  | "matchmaking_result_missed"
  | "matchmaking_intent_posted"
  | "matchmaking_intent_withdrawn"
  /* Sessions. One slot is one session, so `session_created` is the top of the funnel the deck
     measures (意圖 → 邀請 → 確認), and the first event that can be counted per evening rather than
     per member. */
  | "session_created"
  | "session_cancelled"
  /* The Room, now the browse tier behind 睇另外 N 個選擇. `room_ask` carries the tier, so a poke at
     somebody whose availability was never confirmed is counted separately from an ask at somebody
     who said tonight out loud. */
  | "room_go_live"
  | "room_extend"
  | "room_presence_on"
  | "room_ask";

type QueuedEvent = { event:AvailabilityEvent; props?:Record<string,unknown>; at:string };

/** Client-side analytics, batched.
 *
 *  This was a deliberate no-op until the club picked a provider, which had the side effect that no
 *  question about matchmaking could be answered with data — including the one that matters most,
 *  whether agreeing to play produces a played match. It now writes to the club's own database:
 *  no vendor, no third-party script, and nothing leaves the deployment.
 *
 *  Batched and flushed on a timer or when the page goes away, so a member tapping through the
 *  shortlist does not fire a request per tap. Everything is best-effort: analytics must never be
 *  visible to a member, as latency or as an error. */

const FLUSH_MS = 5000, MAX_BATCH = 20;
let queue:QueuedEvent[] = [];
let timer:ReturnType<typeof setTimeout>|null = null;

function flush(useBeacon=false){
  if(timer){clearTimeout(timer);timer=null}
  if(!queue.length||typeof window==="undefined")return;
  const batch=queue;queue=[];
  const body=JSON.stringify({events:batch});
  try{
    /* On pagehide a normal fetch is likely to be killed mid-flight; sendBeacon is the only transport
       the browser promises to finish, and losing the last batch of a session is losing exactly the
       events about leaving. */
    if(useBeacon&&navigator.sendBeacon){navigator.sendBeacon("/api/analytics",new Blob([body],{type:"application/json"}));return}
    void fetch("/api/analytics",{method:"POST",headers:{"content-type":"application/json"},body,keepalive:true}).catch(()=>{});
  }catch{/* analytics must never surface to a member */}
}

if(typeof window!=="undefined"){
  window.addEventListener("pagehide",()=>flush(true));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flush(true)});
}

export function trackAvailabilityEvent(event:AvailabilityEvent,props?:Record<string,unknown>) {
  if(typeof window==="undefined")return;
  queue.push({event,props,at:new Date().toISOString()});
  if(queue.length>=MAX_BATCH)return flush();
  timer??=setTimeout(()=>flush(),FLUSH_MS);
}
