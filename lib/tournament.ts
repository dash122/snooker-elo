/** Cup bracket logic, in one place.
 *
 *  The bracket used to be derived three times over — in the bracket view, in the match form's slot
 *  picker, and nowhere on the server at all — each with its own copy of the hash-sort, the byes and
 *  the winner-propagation. Three copies of a recursive tree walk is three chances for the round the
 *  form writes to disagree with the box the member tapped, so the whole thing lives here and is
 *  unit-tested against the shapes that actually bite: odd sign-up counts, byes, walkovers, draws. */

export type Walkover = { round:number; index:number; winner:string; reason?:string };

export type TournamentLike = {
  id:string;
  name:string;
  signupDeadline:string;
  signups:string[];
  /** Frozen at the moment sign-ups close. Absent on a cup that has not been drawn yet — and the
      reason the bracket stops reshuffling itself every time the roster is edited afterwards. */
  draw?:string[];
  drawnAt?:string;
  /** Whether the cup plays off the club's suggested handicap or level. Read by anything that quotes
      a tie's terms — a handicap printed beside a level cup's tie is a number nobody plays to. */
  handicapMode?:"suggested"|"none";
  walkovers?:Walkover[];
};

export type CupMatchLike = {
  id?:string; a:string; b:string; scoreA:number; scoreB:number;
  status?:string; mode?:string;
  tournamentId?:string; tournamentRound?:number; tournamentMatchIndex?:number;
};

export type SlotState = "tbd"|"waiting"|"ready"|"played"|"walkover"|"bye"|"dead";

export type BracketSlot<M extends CupMatchLike = CupMatchLike> = {
  round:number; index:number;
  a:string; b:string;
  /** Whether each side is final — a side can be empty *and* final (the feeder is a dead slot, which
      is exactly how a bye is told apart from "we don't know yet"). */
  aSettled:boolean; bSettled:boolean;
  match?:M; walkover?:Walkover;
  winner:string; settled:boolean;
  state:SlotState;
};

export type Bracket<M extends CupMatchLike = CupMatchLike> = {
  size:number; rounds:number;
  slots:BracketSlot<M>[];
  /** Set once the final has a winner. */
  champion:string;
};

/** The stored deadline is either a date or a `datetime-local` string, and it always means Hong Kong
    time — the club is in one timezone and a member's phone abroad must not move the deadline. */
export function deadlineDate(signupDeadline:string|undefined|null):Date|null {
  if(!signupDeadline)return null;
  const value=new Date(`${signupDeadline.length===10?`${signupDeadline}T23:59`:signupDeadline}:00+08:00`);
  return Number.isNaN(value.getTime())?null:value;
}

export function signupsClosed(tournament:Pick<TournamentLike,"signupDeadline">,now=Date.now()):boolean {
  const deadline=deadlineDate(tournament.signupDeadline);
  return Boolean(deadline&&deadline.getTime()<=now);
}

const hash=(value:string)=>{
  let result=2166136261;
  for(const character of value){result^=character.charCodeAt(0);result=Math.imul(result,16777619)}
  return result>>>0;
};

/** The draw order, seeded by the cup id so it is reproducible: the server computes exactly the order
    a client would have shown, which is what lets the freeze be a confirmation rather than a surprise
    reshuffle. */
export function computeDraw(tournament:Pick<TournamentLike,"id"|"signups">):string[] {
  return [...new Set(tournament.signups??[])].sort((left,right)=>hash(`${tournament.id}:${left}`)-hash(`${tournament.id}:${right}`));
}

/** What the bracket should be built from: the frozen draw once it exists, otherwise the order the
    freeze would produce. Only meaningful after the deadline. */
export function drawOrder(tournament:TournamentLike):string[] {
  const stored=tournament.draw?.filter(id=>Boolean(id))??[];
  return stored.length?stored:computeDraw(tournament);
}

export function bracketShape(entrants:number):{size:number;rounds:number} {
  if(entrants<2)return {size:0,rounds:0};
  const size=2**Math.ceil(Math.log2(entrants));
  return {size,rounds:Math.log2(size)};
}

export function roundLabel(round:number,total:number):string {
  const remaining=total-round;
  return remaining<=0?"決賽":remaining===1?"四強":remaining===2?"八強":`${2**(remaining+1)}強`;
}

/** The round a recorded cup match belongs to, in words — "八強", "準決賽", "決賽".
 *
 *  Derived from the entrant count and the round stored on the match, so it costs no bracket build:
 *  a history list drawing a hundred cards must not rebuild a bracket for each one. An out-of-range
 *  round returns nothing rather than a wrong label; a cup tie whose stage cannot be named is still a
 *  cup tie, and the surfaces fall back to the cup's name alone. */
export function matchRoundLabel(entrants:number,round:number|undefined|null):string {
  const {rounds}=bracketShape(entrants);
  if(!rounds||!round||round<1||round>rounds)return "";
  return roundLabel(round,rounds);
}

function matchWinner(match:CupMatchLike|undefined):string {
  if(!match)return "";
  return match.scoreA>match.scoreB?match.a:match.scoreB>match.scoreA?match.b:"";
}

export function cupMatches<M extends CupMatchLike>(matches:M[],tournamentId:string):M[] {
  return matches.filter(match=>match.mode==="cup"&&match.tournamentId===tournamentId&&match.status!=="void");
}

/** Build the whole bracket bottom-up. Iterative rather than the recursive `participants()` it
    replaces: each slot needs its feeders' *settled* flag as well as their winner, and recomputing
    that recursively per slot re-walked the subtree once per box. */
export function buildBracket<M extends CupMatchLike>(tournament:TournamentLike,matches:M[],options:{now?:number}={}):Bracket<M> {
  const now=options.now??Date.now();
  const closed=signupsClosed(tournament,now);
  const order=closed?drawOrder(tournament):[];
  const {size,rounds}=bracketShape(order.length);
  if(!size)return {size:0,rounds:0,slots:[],champion:""};
  const played=cupMatches(matches,tournament.id);
  const walkovers=tournament.walkovers??[];
  const slots:BracketSlot<M>[]=[];
  const at=(round:number,index:number)=>slots.find(slot=>slot.round===round&&slot.index===index);
  for(let round=1;round<=rounds;round++){
    for(let index=1;index<=size/2**round;index++){
      const first=round===1?order[(index-1)*2]??"":at(round-1,(index-1)*2+1)!.winner;
      const second=round===1?order[(index-1)*2+1]??"":at(round-1,(index-1)*2+2)!.winner;
      const firstSettled=round===1||at(round-1,(index-1)*2+1)!.settled;
      const secondSettled=round===1||at(round-1,(index-1)*2+2)!.settled;
      const match=played.find(item=>(item.tournamentRound??1)===round&&(item.tournamentMatchIndex??1)===index);
      const declared=walkovers.find(item=>item.round===round&&item.index===index);
      /* A walkover only counts for someone actually in the slot: an admin's entry that predates a
         re-draw must not hand the tie to a player who is no longer in that box. */
      const walkover=declared&&(declared.winner===first||declared.winner===second)?declared:undefined;
      const bothSettled=firstSettled&&secondSettled;
      const byeWinner=bothSettled&&Boolean(first)!==Boolean(second)?first||second:"";
      const winner=matchWinner(match)||walkover?.winner||byeWinner;
      const settled=Boolean(winner)||(bothSettled&&!first&&!second);
      const state:SlotState=match?"played"
        :walkover?"walkover"
        :byeWinner?"bye"
        :bothSettled&&!first&&!second?"dead"
        :first&&second?"ready"
        :first||second?"waiting"
        :"tbd";
      slots.push({round,index,a:first,b:second,aSettled:firstSettled,bSettled:secondSettled,match,walkover,winner,settled,state});
    }
  }
  return {size,rounds,slots,champion:at(rounds,1)?.winner??""};
}

export function slotAt<M extends CupMatchLike>(bracket:Bracket<M>,round:number,index:number):BracketSlot<M>|undefined {
  return bracket.slots.find(slot=>slot.round===round&&slot.index===index);
}

/** The one box a member actually has business with: their earliest unresolved tie. `ready` means
    "go play it"; `waiting` means their opponent is still being decided. */
export function playerSlot<M extends CupMatchLike>(bracket:Bracket<M>,playerId:string|undefined):BracketSlot<M>|undefined {
  if(!playerId)return undefined;
  return bracket.slots.find(slot=>(slot.a===playerId||slot.b===playerId)&&(slot.state==="ready"||slot.state==="waiting"));
}

export function opponentIn(slot:BracketSlot|undefined,playerId:string|undefined):string {
  if(!slot||!playerId)return "";
  return slot.a===playerId?slot.b:slot.b===playerId?slot.a:"";
}

/** Knocked out, as opposed to merely not playing right now — used to explain a bracket that no
    longer has a box for you. */
export function playerEliminated(bracket:Bracket,playerId:string|undefined):boolean {
  if(!playerId||!bracket.slots.length)return false;
  if(bracket.champion===playerId)return false;
  const involved=bracket.slots.filter(slot=>slot.a===playerId||slot.b===playerId);
  if(!involved.length)return false;
  return involved.every(slot=>slot.settled&&slot.winner!==playerId);
}

export type ShuffleResult = {ok:true;tournament:TournamentLike}|{ok:false;error:string};

/** Re-roll the draw order, for an admin who wants a different bracket than the one the hash gave
 *  them — before or after the freeze, as long as nobody has actually played yet.
 *
 *  `computeDraw` is deterministic (seeded by the cup id), so there is no "shuffle again" lever on
 *  it; this is that lever, applied to whatever order is currently in effect and written back as the
 *  frozen `draw`. Refused once any cup tie has a recorded result: a played match names its two
 *  players, and reshuffling out from under it would leave the scorecard pointing at a box the
 *  bracket no longer agrees with. Walkovers are dropped with it — `buildBracket` already ignores one
 *  declared for a player no longer in that slot, but a reshuffle is exactly the moment a stale entry
 *  would otherwise wait to misfire against whoever moved in. */
export function shuffleDraw(tournament:TournamentLike,matches:CupMatchLike[]=[]):ShuffleResult {
  const order=drawOrder(tournament);
  if(order.length<2)return {ok:false,error:"報名人數不足兩人"};
  if(cupMatches(matches,tournament.id).length)return {ok:false,error:"已有賽果，不能重新抽籤"};
  const shuffled=[...order];
  for(let i=shuffled.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
  }
  return {ok:true,tournament:{...tournament,draw:shuffled,drawnAt:new Date().toISOString(),walkovers:[]}};
}

export type SwapResult = {ok:true;tournament:TournamentLike;kind:"swap"|"substitute"}|{ok:false;error:string};

/** Move a player in or out of a frozen draw, without re-running it.
 *
 *  Two things an admin actually asks for, and they are the same edit seen from either end: two
 *  entrants trading boxes, or a no-show being replaced by a reserve. Both are position surgery on
 *  `draw` — never a recompute, because `computeDraw` is seeded by the sign-up list and re-running it
 *  after a withdrawal re-pairs everyone who has already been told who they are playing.
 *
 *  Refused once a side has a result: a played match names its two players, so moving one of them out
 *  of the box would leave the bracket disagreeing with the scorecard. Walkovers declared for a
 *  player who is leaving go with them — `buildBracket` ignores a stale one anyway, but leaving it
 *  behind would hand the tie back if that player ever returned. */
export function swapPlayer(
  tournament:TournamentLike,
  outgoingId:string,
  incomingId:string,
  matches:CupMatchLike[]=[],
):SwapResult {
  if(!outgoingId||!incomingId)return {ok:false,error:"需要兩名球員"};
  if(outgoingId===incomingId)return {ok:false,error:"不能與自己對調"};
  const draw=drawOrder(tournament);
  const outgoingAt=draw.indexOf(outgoingId);
  if(outgoingAt<0)return {ok:false,error:"該球員不在籤表內"};
  const incomingAt=draw.indexOf(incomingId);

  const played=cupMatches(matches,tournament.id);
  const hasResult=(playerId:string)=>played.some(match=>match.a===playerId||match.b===playerId);
  if(hasResult(outgoingId))return {ok:false,error:"該球員已有賽果，不能更換"};
  if(incomingAt>=0&&hasResult(incomingId))return {ok:false,error:"該球員已有賽果，不能更換"};

  const next=[...draw];
  if(incomingAt>=0){ next[outgoingAt]=incomingId; next[incomingAt]=outgoingId; }
  else next[outgoingAt]=incomingId;

  const signups=[...new Set(tournament.signups??[])];
  const nextSignups=incomingAt>=0?signups:signups.map(id=>id===outgoingId?incomingId:id);
  /* A reserve who never signed up still has to appear in the roster the rest of the app counts. */
  if(incomingAt<0&&!nextSignups.includes(incomingId))nextSignups.push(incomingId);

  const walkovers=(tournament.walkovers??[]).filter(item=>incomingAt>=0||item.winner!==outgoingId);
  return {
    ok:true,
    kind:incomingAt>=0?"swap":"substitute",
    tournament:{...tournament,signups:nextSignups,draw:next,...(tournament.walkovers?{walkovers}:{})},
  };
}

/** First-round pairings by player, for the "you were drawn against X" notification. */
export function firstRoundPairings(tournament:TournamentLike,now=Date.now()):{playerId:string;opponentId:string;index:number}[] {
  const bracket=buildBracket(tournament,[],{now});
  return bracket.slots.filter(slot=>slot.round===1).flatMap(slot=>[
    slot.a?{playerId:slot.a,opponentId:slot.b,index:slot.index}:null,
    slot.b?{playerId:slot.b,opponentId:slot.a,index:slot.index}:null,
  ].filter((entry):entry is {playerId:string;opponentId:string;index:number}=>entry!=null));
}

/** The round a cup has reached — the live one, or the final once everything is settled. Lives here
    rather than in the share copy so the wording module stays free of bracket maths. */
/** A cup a player finished at the very top of, or one step from it. */
export type Honour = { tournamentId:string; name:string; place:"champion"|"runnerUp" };

/** A player's cup honours, newest cup first.
 *
 *  Only the two places worth a badge. Third is not a place in a knockout — the two beaten
 *  semi-finalists are indistinguishable without a play-off the club has never held — so claiming one
 *  would be inventing a result, and a badge that overstates is worse than no badge.
 *
 *  Runner-up is carried because the surfaces choose to show it only when a player has no title yet.
 *  Someone who reached a final and lost it has done something the leaderboard cannot show, and a
 *  profile that says nothing about it is a profile that forgets the club's own history. */
export function playerHonours<M extends CupMatchLike>(
  tournaments:TournamentLike[],matches:M[],playerId:string,options:{now?:number}={}
):Honour[] {
  if(!playerId)return [];
  const honours:Honour[]=[];
  for(const tournament of tournaments){
    if(!tournament.signups?.includes(playerId))continue;
    const bracket=buildBracket(tournament,matches,options);
    if(!bracket.champion)continue;
    if(bracket.champion===playerId){
      honours.push({tournamentId:tournament.id,name:tournament.name,place:"champion"});
      continue;
    }
    /* The final is the only slot in the last round, and its loser is the runner-up. A bye into an
       unplayed final leaves the other seat empty, in which case there is no runner-up to name. */
    const final=slotAt(bracket,bracket.rounds,1);
    const loser=final?(final.a===bracket.champion?final.b:final.a):"";
    if(loser===playerId)honours.push({tournamentId:tournament.id,name:tournament.name,place:"runnerUp"});
  }
  return honours;
}

export function currentRoundLabel(bracket:Bracket|null|undefined):string {
  if(!bracket?.rounds)return "";
  const live=bracket.slots.find(slot=>slot.state==="ready"||slot.state==="waiting");
  return roundLabel(live?.round??bracket.rounds,bracket.rounds);
}
