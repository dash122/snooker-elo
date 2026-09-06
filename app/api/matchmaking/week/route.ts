import { requireMember } from "../../../../db/auth";
import { listAvailability, listOwnAvailability } from "../../../../db/availability";
import { livePresence } from "../../../../db/presence.pg";
import { clubPublishedThisWeek, memberJoinedAt, publishStreak } from "../../../../db/week-band.pg";
import { addDaysHongKong, dayRangeHongKong, hkDate } from "../../../../lib/availability";
import { BAND_COLUMNS, instantColumn, ratingBand } from "../../../../lib/week-band";

/* --- 約戰 · one read for the whole tab --------------------------------------
 *
 * The band recomputes overlap on every frame of a drag, so it cannot ask the server who overlaps —
 * the answer has to already be in the browser. That is what this endpoint is for: one request
 * carrying seven nights of published time, and all the drag maths happens locally against it.
 *
 * It also replaces the fan-out the tab used to do (`/api/venues`, `/api/venues/[id]`, `/api/room`,
 * `/api/availability` × 3), which mattered less for the round trips than for the fact that each
 * answered a *different* question and the screen had to reconcile them.
 *
 * The gate is enforced here, not in the component. A locked row leaves this handler with no name, no
 * short, no avatar and a rating rounded to a 50-point band, because a gate implemented in the client
 * is not a gate — it is a blur over a payload anyone can read in devtools. What the reader gets back
 * is enough to see the club is busy (count, position, band) and not enough to know who. */

const HORIZON = 7;

/** New members are shown everything for their first week. A gate is a reciprocity mechanism among
    people who already know what they are joining; making it the first thing a new member meets is
    just a locked door. */
const GRACE_DAYS = 7;

type Row = {
  playerId:string;
  /** Null while the reader has not published — the wire itself carries no identity. */
  name:string|null;
  short:string|null;
  colour:string|null;
  avatar:string|null;
  /** Exact when unlocked, a 50-point band string when not. */
  rating:number|null;
  ratingBand:string;
  atClub:boolean;
  slots:{from:number;to:number}[];
};

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const start=url.searchParams.get("start")??hkDate();
    const dates=Array.from({length:HORIZON},(_,index)=>addDaysHongKong(start,index));

    const member=await requireMember();
    const me=member?.statePlayerId??null;

    /* One window covering the whole strip: the first date's opening hour to the last date's close,
       which is the morning after it. */
    const from=dayRangeHongKong(dates[0]).startAt;
    const to=dayRangeHongKong(addDaysHongKong(dates[dates.length-1],1)).endAt;

    /* Two waves, not one seven-wide fan-out. The pool is capped at four connections
       (`db/sql.ts`), so issuing every query at once made this route contend with itself and, on a
       cold start, queue behind the presence DDL that used to run here — the tab's first paint then
       hung with no way back. The first wave is what the band cannot render without; the second is
       decoration, and every part of it degrades to a harmless default rather than failing the read. */
    const [members,mine]=await Promise.all([
      listAvailability(from,to),
      me?listOwnAvailability(me):Promise.resolve([]),
    ]);

    const [presence,stats,clubCount,joined]=await Promise.all([
      livePresence().catch(()=>({} as Record<string,unknown>)),
      me?publishStreak(me).catch(()=>({weeks:0,publishedThisWeek:false})):Promise.resolve({weeks:0,publishedThisWeek:false}),
      clubPublishedThisWeek().catch(()=>0),
      member?memberJoinedAt(member.email).catch(()=>null):Promise.resolve(null),
    ]);

    /* Own presence is a lookup in the map we already have, not a second query against the same
       table — `livePresence()` is keyed by player id and includes the reader. */
    const mineAtClub=Boolean(me&&Object.prototype.hasOwnProperty.call(presence,me));

    /* Published anything still to come? That, and only that, is what lifts the gate — the same slots
       everyone else is reading, so the exchange is symmetric by construction. */
    const hasPublished=mine.length>0;
    const joinedAt=joined?Date.parse(joined):null;
    const inGrace=joinedAt!==null&&Number.isFinite(joinedAt)&&Date.now()-joinedAt<GRACE_DAYS*86400000;
    const locked=Boolean(me)&&!hasPublished&&!inGrace;

    /* Signed-out readers get the shape of the week and nothing else: counts are public, people are
       not, and there is no reciprocity to appeal to before there is an account. */
    const anonymous=!me;

    const days=dates.map(date=>{
      const rows:Row[]=[];
      for(const person of members){
        if(person.id===me)continue;
        const slots=person.slots
          .map(slot=>({from:instantColumn(date,slot.startAt),to:instantColumn(date,slot.endAt)}))
          .filter(slot=>slot.to>0&&slot.from<BAND_COLUMNS)
          .map(slot=>({from:Math.max(0,slot.from),to:Math.min(BAND_COLUMNS,slot.to)}))
          .filter(slot=>slot.to>slot.from);
        if(!slots.length)continue;
        const reveal=!locked&&!anonymous;
        rows.push({
          playerId:reveal?person.id:`hidden-${person.id.slice(0,6)}`,
          name:reveal?person.name:null,
          short:reveal?person.short:null,
          colour:reveal?(person.colour??null):null,
          avatar:reveal?(person.avatar??null):null,
          rating:reveal?Math.round(person.rating):null,
          ratingBand:ratingBand(person.rating),
          atClub:reveal?Object.prototype.hasOwnProperty.call(presence,person.id):false,
          slots,
        });
      }
      const mineOnDay=mine
        .map(slot=>({id:slot.id,from:instantColumn(date,slot.startAt),to:instantColumn(date,slot.endAt)}))
        .filter(slot=>slot.to>0&&slot.from<BAND_COLUMNS&&slot.to>slot.from);
      return {date,people:rows,mine:mineOnDay};
    });

    return Response.json({
      start,
      days,
      gate:{locked,anonymous,inGrace,hasPublished},
      stats:{streakWeeks:stats.weeks,publishedThisWeek:stats.publishedThisWeek,clubPublishedThisWeek:clubCount},
      /* 「現正在會所」在名單上是別人的狀態，這裡是自己的 — 只顯示不能設定的話，那一行永遠不會亮。 */
      atClub:mineAtClub,
      me,
    },{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Matchmaking unavailable"},{status:500});
  }
}
