import { requireMember } from "../../../db/auth";
import { liveIntentsDetailed } from "../../../db/intents";
import { livePresence, myPresence, playerRating } from "../../../db/presence.pg";
import { listAvailability } from "../../../db/availability";
import { listOpenCalls } from "../../../db/open-calls";
import { hkDate, intersectIntervals, isOpenCallLive, overlapMinutes, type Interval } from "../../../lib/availability";
import { rankRoom, shouldOfferUnconfirmed, type RoomInput } from "../../../lib/room";

/** Everything The Room draws, in one request.
 *
 *  Assembled server-side rather than left to the client to stitch from four endpoints, because the
 *  ordering is the product here: who leads the board is a judgement made from presence, level and
 *  declared preference together, and a client assembling it from separately-cached fetches would
 *  show a board that disagrees with itself while the slower half arrives. */

export const dynamic="force-dynamic";

/** How far ahead a live window may start and still belong on tonight's board. A member who said they
    want a game next Tuesday is real, but they are not part of the decision being made right now. */
const HORIZON_HOURS = 30;

export async function GET(){
  try{
    const member=await requireMember();
    const me=member?.statePlayerId??null;
    const now=Date.now();
    const horizon=new Date(now+HORIZON_HOURS*3600_000).toISOString();

    const [intents,presence,mine,calls,myRating]=await Promise.all([
      liveIntentsDetailed(),
      livePresence(),
      me?myPresence(me):Promise.resolve(null),
      listOpenCalls().catch(()=>[]),
      me?playerRating(me):Promise.resolve(0),
    ]);

    const myIntent=me?intents.find(intent=>intent.playerId===me)??null:null;

    /* Members who said so themselves. A window starting past the horizon is dropped rather than
       shown as "later" — the board is about tonight, and padding it with next week would make it
       look busier than the evening actually is. */
    const others=intents.filter(intent=>intent.playerId!==me
      &&(!intent.startAt||intent.startAt<=horizon));

    const inputs:RoomInput[]=others.map(intent=>({
      id:intent.playerId,rating:intent.player.rating,tier:"live",
      window:intent.startAt&&intent.endAt?{startAt:intent.startAt,endAt:intent.endAt}:null,
      preference:intent.preference,atClub:Boolean(presence[intent.playerId]),
    }));

    /* An empty room is worse than no room — it is the moment a member decides the club is dead. So a
       thin board reaches for the people whose *published* time suggests tonight and offers to ask
       them. Note what this deliberately does not do: it never claims they are free. Unconfirmed time
       earns a member a question, not a place among the members who actually said something. */
    let unconfirmed:{id:string;name:string;short:string;rating:number;colour:string|null;avatar:string|null}[]=[];
    if(shouldOfferUnconfirmed(inputs.length)&&me){
      const declared=new Set([me,...intents.map(intent=>intent.playerId)]);
      const tonight:Interval={startAt:new Date(now).toISOString(),endAt:horizon};
      const members=await listAvailability(tonight.startAt,tonight.endAt);
      unconfirmed=members
        .filter(candidate=>!declared.has(candidate.id))
        .filter(candidate=>overlapMinutes(intersectIntervals(candidate.slots as Interval[],[tonight]))>=30)
        .slice(0,6)
        .map(candidate=>({id:candidate.id,name:candidate.name,short:candidate.short,rating:candidate.rating,colour:candidate.colour??null,avatar:candidate.avatar??null}));
      for(const candidate of unconfirmed)inputs.push({
        id:candidate.id,rating:candidate.rating,tier:"unconfirmed",window:null,preference:"any",
        atClub:Boolean(presence[candidate.id]),
      });
    }

    const ranked=rankRoom({myRating,members:inputs,now});
    const byId=new Map([
      ...others.map(intent=>[intent.playerId,intent.player] as const),
      ...unconfirmed.map(candidate=>[candidate.id,candidate] as const),
    ]);

    return Response.json({
      today:hkDate(),
      me:me?{
        playerId:me,rating:myRating,
        intent:myIntent?{id:myIntent.id,kind:myIntent.kind,startAt:myIntent.startAt,endAt:myIntent.endAt,preference:myIntent.preference}:null,
        atClub:Boolean(mine),presenceUntil:mine?.expiresAt??null,
      }:null,
      /* The entry carries the ranking's reasoning; the player carries the face. Kept apart so the
         ranking stays testable without a database and the row stays drawable without one. */
      entries:ranked.flatMap(entry=>{
        const player=byId.get(entry.id);
        return player?[{...entry,player}]:[];
      }),
      atClubCount:Object.keys(presence).length,
      calls:calls.filter(call=>isOpenCallLive(call,now)).map(call=>({
        id:call.id,startAt:call.startAt,endAt:call.endAt,venue:call.venue,message:call.message,player:call.player,
      })),
    },{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Room unavailable"},{status:500});
  }
}
