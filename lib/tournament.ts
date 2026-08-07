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
export function currentRoundLabel(bracket:Bracket|null|undefined):string {
  if(!bracket?.rounds)return "";
  const live=bracket.slots.find(slot=>slot.state==="ready"||slot.state==="waiting");
  return roundLabel(live?.round??bracket.rounds,bracket.rounds);
}
