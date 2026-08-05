/* Type-only, and written as `import type` so the test runner's type stripping erases the statement
   outright rather than trying to resolve an extensionless path at runtime. */
import type { Interval } from "./availability";

/* --- The Room -------------------------------------------------------------
 *
 * Everyone who is currently looking for a game, on one screen, sorted by how well they fit me.
 *
 * The shortlist this replaces showed three names and hid the market they came from. In a club this
 * size that is backwards: a thin market needs to look alive, and filtering people out makes it look
 * emptier than it is. So nothing here removes anyone — ranking decides the order, never the
 * membership of the list.
 *
 * The other half of the design is what the room is allowed to contain. A member is only in it if
 * they have said, recently and with an end time, that they want a game. Availability that nobody
 * has confirmed in weeks does not belong: a three-week-old Wednesday slot is not evidence that
 * anybody is free, and showing it as one produces exactly the invitations that never get answered.
 * Unconfirmed time earns a member a *question*, not a place on the board — see `RoomTier`. */

/** What kind of game a member is up for, declared when they go live and remembered afterwards.
 *
 *  This is the field that does the most social work in the whole product. The club runs a public
 *  ELO board, and the reliable consequence of a public ELO board is that a weaker player will not
 *  ask a stronger one — the ask feels like an imposition, so it never happens and both of them stay
 *  home. 「樂意陪新手」 is a standing licence to ask, published in advance, which removes the risk
 *  before the ask is even composed. Nothing else on a member's row can do that. */
export type MatchPreference = "even"|"challenge"|"mentor"|"any";

export const PREFERENCE_LABELS:Record<MatchPreference,string> = {
  even:"勢均力敵", challenge:"想挑戰高手", mentor:"樂意陪新手", any:"求其打下",
};

export const PREFERENCE_HINTS:Record<MatchPreference,string> = {
  even:"想搵水平接近嘅對手",
  challenge:"想搵強過自己嘅對手練習",
  mentor:"歡迎新手或者水平低啲嘅球友",
  any:"邊個都得，打到就好",
};

export function isMatchPreference(value:unknown):value is MatchPreference {
  return value==="even"||value==="challenge"||value==="mentor"||value==="any";
}

/** How far apart two members are, said from my side. A gap of 100 points is roughly the width of one
    「差唔多」 in this club, and every threshold below is expressed in those terms. */
const BAND = 100;

/** Does their declared preference actively welcome *me*?
 *
 *  Deliberately three-valued rather than a filter. "Welcome" is a licence to ask that we can show on
 *  their row; "neutral" is simply the absence of one — never a barrier, never a reason to hide
 *  somebody, because the member's own judgement about who is worth asking is usually better than any
 *  score's. There is no "no": a preference is what somebody would like, not a door they closed. */
export type Licence = "welcome"|"neutral";

export function preferenceLicence(preference:MatchPreference,gap:number):Licence {
  /* `gap` is their rating minus mine: positive means they are the stronger player. */
  if(preference==="any")return "welcome";
  if(preference==="even")return Math.abs(gap)<=BAND?"welcome":"neutral";
  if(preference==="mentor")return gap>=BAND?"welcome":"neutral";
  return gap<=-BAND?"welcome":"neutral";
}

/** The words for a licence, from the asker's point of view. Only ever produced when the licence is
    real — a tag that appears on everybody's row stops carrying information. */
export function licenceNote(preference:MatchPreference,gap:number):string|null {
  if(preferenceLicence(preference,gap)!=="welcome")return null;
  if(preference==="mentor")return "佢歡迎水平低啲嘅球友";
  if(preference==="challenge")return "佢想搵強過自己嘅對手";
  if(preference==="even")return "佢想搵水平接近嘅對手";
  return "佢話邊個都得";
}

/** Level as a distance from me rather than as a rating.
 *
 *  The leaderboard is a different product. Here the only thing a number has to answer is "would this
 *  be a good game", so it is phrased relative to the reader and never as their public standing. */
export function levelLabel(myRating:number,theirRating:number):string {
  const gap=Math.round(theirRating-myRating);
  if(Math.abs(gap)<25)return "水平差唔多";
  return gap>0?`高你 ${gap} 分`:`低你 ${Math.abs(gap)} 分`;
}

/* --- Time left ------------------------------------------------------------
 *
 * A declaration that cannot expire becomes stale data, and stale data is worse than none because it
 * still produces confident-looking matches. So every live status carries an end, and the member is
 * always shown the clock running down on their own — expiry is never a surprise, and extending is
 * one tap, which is the cheapest confirmation signal in the system. */

const minute = 60_000;

export function remainingMinutes(endAt:string,now=Date.now()) {
  return Math.max(0,Math.round((Date.parse(endAt)-now)/minute));
}

/** "仲有 1 小時 40 分". Rounded down to the minute and never optimistic — a countdown that says an
    hour when there are fifty minutes left teaches members not to trust the number. */
export function remainingLabel(endAt:string,now=Date.now()) {
  const minutes=remainingMinutes(endAt,now);
  if(minutes<=0)return "已經完咗";
  if(minutes<60)return `仲有 ${minutes} 分鐘`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return rest?`仲有 ${hours} 小時 ${rest} 分`:`仲有 ${hours} 小時`;
}

/* --- Ranking --------------------------------------------------------------- */

/** Where a member's information came from, which decides what the room may claim about them.
 *
 *  `live` members said so themselves, with an end time, and can be shown as free. `unconfirmed`
 *  members only have a published slot that nobody has touched in a while — the room shows them as a
 *  question ("問佢得唔得閒"), never as an answer. Keeping these apart is what stops a decaying
 *  calendar from quietly poisoning the board. */
export type RoomTier = "live"|"unconfirmed";

/** Where a member sits on the screen. Presence outranks everything: somebody holding a cue right now
    converts at a rate no calendar entry ever will. */
export type RoomGroup = "at-club"|"free-now"|"later"|"unconfirmed";

export type RoomInput = {
  id:string; rating:number; tier:RoomTier;
  /** The window they declared. `null` for a standby-style "ask me", which has no window on purpose. */
  window:Interval|null;
  preference:MatchPreference;
  atClub:boolean;
};

export type RoomEntry = {
  id:string; group:RoomGroup; tier:RoomTier; score:number;
  gap:number; levelLabel:string; preference:MatchPreference;
  licence:Licence; licenceNote:string|null;
  window:Interval|null; atClub:boolean;
};

function group(item:RoomInput,now:number):RoomGroup {
  if(item.tier==="unconfirmed")return "unconfirmed";
  if(item.atClub)return "at-club";
  if(!item.window)return "later";
  return Date.parse(item.window.startAt)<=now?"free-now":"later";
}

const GROUP_ORDER:Record<RoomGroup,number> = {"at-club":0,"free-now":1,later:2,unconfirmed:3};

/** How well does this member fit *me*, within their group.
 *
 *  The weights say something deliberate: closeness of level is the single biggest factor, because it
 *  is what decides whether the frame is worth playing, but a declared welcome is worth nearly as
 *  much as being twenty points apart. That is the point of the preference field — it is supposed to
 *  outrank a marginally better ELO match, since a game that gets asked for beats a better one that
 *  doesn't. Starting sooner breaks the remaining ties, because tonight is the business we are in. */
const WEIGHT = {elo:45,licence:25,soon:15,presence:15};

export function roomScore(input:{gap:number;licence:Licence;startsInMinutes:number|null;atClub:boolean}) {
  const elo=Math.max(1-Math.abs(input.gap)/400,0)*WEIGHT.elo;
  const licence=(input.licence==="welcome"?1:0)*WEIGHT.licence;
  /* Full marks for "right now", tapering to nothing four hours out. A member deciding what to do
     tonight is not weighing a game that starts at midnight against one starting in ten minutes. */
  const soon=input.startsInMinutes===null?WEIGHT.soon*.4
    :Math.max(0,1-Math.max(0,input.startsInMinutes)/240)*WEIGHT.soon;
  const presence=(input.atClub?1:0)*WEIGHT.presence;
  return Math.round((elo+licence+soon+presence)*10)/10;
}

/** The whole room, ordered. Groups first, then fit within a group — never fit across groups, because
    the bands mean different things and a beautifully-matched opponent who is free next Tuesday must
    not sit above a decent one standing at the table now. */
export function rankRoom(input:{myRating:number;members:RoomInput[];now?:number}):RoomEntry[] {
  const now=input.now??Date.now();
  return input.members
    .map(member=>{
      const gap=member.rating-input.myRating;
      const licence=preferenceLicence(member.preference,gap);
      const startsInMinutes=member.window?Math.round((Date.parse(member.window.startAt)-now)/minute):null;
      return {
        id:member.id,group:group(member,now),tier:member.tier,
        score:roomScore({gap,licence,startsInMinutes,atClub:member.atClub}),
        gap:Math.round(gap),levelLabel:levelLabel(input.myRating,member.rating),
        preference:member.preference,licence,licenceNote:licenceNote(member.preference,gap),
        window:member.window,atClub:member.atClub,
      };
    })
    .sort((a,b)=>GROUP_ORDER[a.group]-GROUP_ORDER[b.group]||b.score-a.score||a.id.localeCompare(b.id));
}

/** How full the room has to look before it stops reaching for unconfirmed members.
 *
 *  Below this it is not a board, it is an empty screen — and an empty room is worse than no room,
 *  because it is the moment a member decides the club is dead. So a thin room falls back to the
 *  people whose published time *suggests* tonight and offers to ask them, which turns the screen
 *  from a mirror of supply into a way of creating it. */
export const THIN_ROOM = 3;

export function shouldOfferUnconfirmed(liveCount:number) {
  return liveCount<THIN_ROOM;
}

/* --- Going live ------------------------------------------------------------
 *
 * "而家得閒", "今晚得閒" and "呢幾日都得" are three different promises, and the difference is how
 * settled they are. Flattening them into one control is where this normally goes wrong: the last one
 * is not a window at all, and inventing a 19:00–23:00 block on the member's behalf would be the app
 * fabricating availability — which produces precisely the invitations nobody answers. */

export type GoLiveShape = "now"|"tonight"|"soon";

/** The end of a "free now" declaration: a duration from the current half hour.
    Rounds the start *down* the way `nowInterval` does — at 19:42 a member is free now, not at 20:00. */
export const NOW_DURATIONS = [60,90,120,180,240];

/** Defaults offered for 「今晚得閒到幾點」. The club plays to 02:00, so a late end is normal here
    rather than a mistake, but 23:00 is the honest middle of a weeknight. */
export const TONIGHT_ENDS = ["21:00","22:00","23:00","00:00","01:00"];

/** How long a single "+1 小時" adds, and the ceiling it cannot push past.
    Extending is meant to be a confirmation, not a way to quietly recreate an all-night claim nobody
    means by the time it matters. */
export const EXTEND_MINUTES = 60;
export const MAX_LIVE_HOURS = 8;

export function extendedEnd(endAt:string,startAt:string|null,now=Date.now()) {
  const from=Math.max(Date.parse(endAt),now);
  const anchor=startAt?Date.parse(startAt):now;
  const ceiling=anchor+MAX_LIVE_HOURS*60*minute;
  const next=Math.min(from+EXTEND_MINUTES*minute,ceiling);
  return next<=Date.parse(endAt)?null:new Date(next).toISOString();
}
