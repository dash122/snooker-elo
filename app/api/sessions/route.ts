import { requireMember } from "../../../db/auth";
import { createSession, listSessions, listAvailability } from "../../../db/availability";
import { getState } from "../../../db/state";
import { listInvitesFor } from "../../../db/invites";
import { listOpenCalls } from "../../../db/open-calls";
import { reliabilityByPlayer } from "../../../db/matchmaking.pg";
import { liveIntentsByPlayer } from "../../../db/intents";
import { announceAvailability } from "../../../db/matchmaking-actions.pg";
import { hasRecordedMatchSince, hkDate, intersectIntervals, isOpenCallLive, matchesBetween,
  rankOpponents, validateAvailabilityInterval, type Interval } from "../../../lib/availability";
import { handicapSentence } from "../../../lib/handicap";
import { levelLabel } from "../../../lib/room";
import { sessionStatus, sortSessions, visibleSessions } from "../../../lib/sessions";

/** A member's own sessions, each carrying the answer for that evening.
 *
 *  The recommendation lives *inside* the session rather than floating beside it, because a
 *  recommendation is always about a particular block of time. A global shortlist leaves the member
 *  to work out which of their evenings it refers to — which is exactly the analysis the app is
 *  supposed to be doing for them. */

export const dynamic="force-dynamic";

/** How many opponents a session card offers. One is the answer; the other two expand in place when
    the member taps 睇另外 N 個選擇 — never a separate surface, per 原則 02: 先推薦，後瀏覽. */
const PER_SESSION = 3;

/** How far ahead the market looks, and how many rows it shows. Wide enough that a member with no
    session of their own still sees a real evening's worth of activity; capped so the strip stays a
    glance, not a second shortlist to analyse. */
const MARKET_HORIZON_HOURS = 72;
const MARKET_LIMIT = 8;

type ClubState={players:{id:string;name:string;short:string;rating:number;colour?:string|null;avatar?:string|null;active:boolean}[];
  matches:{a:string;b:string;scoreA:number;scoreB:number;playedOn:string;status:"confirmed"|"void"}[];
  settings:{handicapPointsToElo:number;handicapMinimumElo:number;handicapSensitivityRange:number;handicapSensitivityWidth:number}};

async function clubState():Promise<ClubState|null>{
  const raw=await getState();
  return raw?JSON.parse(raw) as ClubState:null;
}

export async function GET(){
  const member=await requireMember();
  if(!member?.statePlayerId)return Response.json({sessions:[],signedIn:Boolean(member)},{headers:{"cache-control":"no-store"}});
  const me=member.statePlayerId;
  try{
    const now=Date.now();
    const [mine,state,invites,reliability,intents,openCalls]=await Promise.all([
      listSessions(me),
      clubState(),
      listInvitesFor(me),
      reliabilityByPlayer().catch(()=>({})),
      liveIntentsByPlayer().catch(()=>({})),
      listOpenCalls().catch(()=>[]),
    ]);
    const players:ClubState["players"]=state?.players??[];
    const matches:ClubState["matches"]=state?.matches??[];
    const settings:ClubState["settings"]={handicapPointsToElo:25,handicapMinimumElo:7,handicapSensitivityRange:16,handicapSensitivityWidth:250,...(state?.settings??{})};
    const myRating=players.find(player=>player.id===me)?.rating??0;

    const accepted=[...invites.sent,...invites.received].filter(invite=>invite.status==="accepted");
    const engaged=new Set([...invites.sent,...invites.received].filter(invite=>invite.status==="pending"||invite.status==="accepted")
      .map(invite=>invite.fromPlayer.id===me?invite.toPlayer.id:invite.fromPlayer.id));

    /* One availability read covers every session: the windows are all inside the same horizon, and
       ranking each session against the same roster keeps the club's supply consistent from card to
       card. The market strip needs a real horizon even when this member has zero sessions of their
       own — that is exactly the screen it exists to fill, so it can never collapse to "now" the way
       a horizon derived only from `mine` would. */
    const marketHorizon=new Date(now+MARKET_HORIZON_HOURS*3600_000).toISOString();
    const horizon=mine.length&&mine[mine.length-1].endAt>marketHorizon?mine[mine.length-1].endAt:marketHorizon;
    const roster=await listAvailability(new Date(now).toISOString(),horizon).catch(()=>[]);
    const otherMembers=roster.filter(other=>other.id!==me&&!engaged.has(other.id));

    const sessions=visibleSessions(sortSessions(mine.map(item=>{
      /* A confirmed game counts as this session's booking when it sits inside the window — the
         member set the time aside and then filled it, which is the whole life cycle of a session. */
      const booking=accepted.find(invite=>{
        const slot=invite.counter??invite;
        return Date.parse(slot.startAt)<Date.parse(item.endAt)&&Date.parse(slot.endAt)>Date.parse(item.startAt);
      });
      const opponentId=booking?(booking.fromPlayer.id===me?booking.toPlayer.id:booking.fromPlayer.id):null;
      return {...item,
        booking:booking&&opponentId?{inviteId:booking.id,opponentId,
          startAt:(booking.counter??booking).startAt,endAt:(booking.counter??booking).endAt}:null,
        recorded:Boolean(booking&&opponentId&&hasRecordedMatchSince(matches,me,opponentId,hkDate(new Date(item.startAt)))),
      };
    }),now),now);

    const byId=new Map(players.map(player=>[player.id,player]));
    const withMatches=sessions.map(item=>{
      const status=sessionStatus(item,now);
      const window:Interval={startAt:item.startAt,endAt:item.endAt};
      const opponents=status==="looking"
        ?rankOpponents({
            mine:[window],rating:myRating,window,
            opponents:otherMembers.map(other=>({id:other.id,rating:other.rating,slots:other.slots as Interval[]})),
            recentMatches:id=>matchesBetween(matches,me,id).length,
            signals:id=>(reliability as Record<string,{acceptRate?:number;showRate?:number;responseHours?:number}>)[id],
            intents:id=>(intents as Record<string,{kind:"tonight"|"window"|"standby"}>)[id],
          }).filter(candidate=>candidate.qualifies).slice(0,PER_SESSION)
        :[];

      return {
        id:item.id,startAt:item.startAt,endAt:item.endAt,venue:item.venue,note:item.note,status,
        booking:item.booking?{...item.booking,opponent:byId.get(item.booking.opponentId)??null}:null,
        /* Every recommendation answers 點解係佢、點解係而家、點解可以放心約 — and then the handicap
           answers the question a stranger board can only leave to the two players to negotiate. */
        options:opponents.flatMap(candidate=>{
          const player=byId.get(candidate.id);
          if(!player)return [];
          const overlap=intersectIntervals([window],candidate.overlaps)[0]??window;
          const reasons:string[]=[];
          reasons.push(`你哋${hkDate(new Date(overlap.startAt))===hkDate()?"今晚":"嗰日"}都得閒`);
          if(candidate.intent)reasons.push("佢正想搵一局");
          if(!matchesBetween(matches,me,candidate.id).length)reasons.push("從未交手");
          else if(candidate.recent===0)reasons.push("近 30 日未交手");
          if(candidate.signals?.responseHours!==undefined&&candidate.signals.responseHours<=3)
            reasons.push(`通常 ${Math.max(1,Math.round(candidate.signals.responseHours))} 小時內回覆`);
          else if(candidate.signals?.showRate!==undefined&&candidate.signals.showRate>=.8)reasons.push("準時出現");
          return [{
            player:{id:player.id,name:player.name,short:player.short,rating:player.rating,colour:player.colour,avatar:player.avatar},
            difference:Math.round(candidate.difference),
            slot:{startAt:overlap.startAt,endAt:overlap.endAt},
            reasons:reasons.slice(0,4),
            handicap:handicapSentence({myRating,theirRating:player.rating,settings,matches,me,them:player.id}),
          }];
        }),
      };
    });

    /* MARKET — everyone else's open time, shown whether or not this member has a session of their
     * own. Small clubs live or die on this screen looking alive: a member's first look at an empty
     * tab is the moment they decide the product is dead, and the fix is not a better empty state, it
     * is proof that other people are actually doing this right now. So the market renders on the
     * cold open too — it is the primary content there, not a footnote below a shortlist.
     *
     * Each entry is one member's *soonest* published window — not a ranked recommendation, just
     * "here is when they're free" — plus the same handicap sentence the best-match card uses, so the
     * differentiator shows up everywhere a member might consider an opponent, not only the one the
     * algorithm picked for them. Sorted soonest first: liveliness, not fit, is the point of this
     * list. */
    const market=otherMembers
      .flatMap(other=>{
        const player=byId.get(other.id);
        const next=[...other.slots].filter(slot=>Date.parse(slot.endAt)>now)
          .sort((a,b)=>a.startAt.localeCompare(b.startAt))[0];
        if(!player||!next)return [];
        return [{
          player:{id:player.id,name:player.name,short:player.short,rating:player.rating,colour:player.colour,avatar:player.avatar},
          slot:{startAt:next.startAt,endAt:next.endAt},
          difference:Math.round(player.rating-myRating),
          levelLabel:levelLabel(myRating,player.rating),
          handicap:handicapSentence({myRating,theirRating:player.rating,settings,matches,me,them:player.id}),
        }];
      })
      .sort((a,b)=>a.slot.startAt.localeCompare(b.slot.startAt)||Math.abs(a.difference)-Math.abs(b.difference))
      .slice(0,MARKET_LIMIT);

    /* Open calls belong in the same strip: a table somebody already booked and opened to the club is
       strictly less work to join than any session above, and hiding it behind a second surface (as
       the old Room did) buries the easiest "yes" on the whole screen. */
    const calls=openCalls
      .filter(call=>isOpenCallLive(call,now))
      .slice(0,MARKET_LIMIT)
      .map(call=>({id:call.id,startAt:call.startAt,endAt:call.endAt,venue:call.venue,message:call.message,
        player:call.player,mine:call.player.id===me}));

    return Response.json({sessions:withMatches,market,calls,signedIn:true,myRating,today:hkDate()},
      {headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Sessions unavailable"},{status:500});
  }
}

export async function POST(request:Request){
  const member=await requireMember();
  if(!member)return Response.json({error:"Sign in required"},{status:401});
  if(!member.statePlayerId)return Response.json({error:"Link a player profile first"},{status:403});
  try{
    const body=await request.json() as {startAt?:unknown;endAt?:unknown;venue?:unknown;note?:unknown};
    const window=validateAvailabilityInterval({startAt:String(body.startAt),endAt:String(body.endAt)});
    const created=await createSession(member.statePlayerId,{...window,
      venue:typeof body.venue==="string"?body.venue.trim().slice(0,60):"",
      note:typeof body.note==="string"?body.note.trim().slice(0,200):""});
    if(!created)return Response.json({error:"呢段時間你已經開咗場，改一改時間先。"},{status:409});
    /* The same announcement every other publish path fires: opening a session is telling the club
       you want a game, so the well-matched few get asked without the member doing anything more. */
    const {offers}=await announceAvailability(member.statePlayerId,[window]).catch(()=>({offers:0}));
    return Response.json({session:created,offers},{status:201});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Could not create session"},{status:400});
  }
}
