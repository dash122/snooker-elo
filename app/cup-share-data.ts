import { getState } from "../db/state";
import { proposeHandicap, suggestedHandicap, type HandicapSettings } from "../lib/handicap";
import { cupShareState } from "../lib/cup-share";
import { buildBracket, currentRoundLabel, signupsClosed, type CupMatchLike, type TournamentLike } from "../lib/tournament";

/** One cup, read once, in the shape both shared surfaces need.
 *
 *  The page draws the bracket from it and the link-preview image draws the poster from it, and they
 *  must never disagree — a thumbnail promising 「仲有 1 日」 above a page that says entries closed is
 *  worse than no thumbnail. Sharing the loader is what makes that impossible rather than merely
 *  unlikely. */

type Player = { id:string; name:string; short?:string|null; rating?:number; colour?:string|null; avatar?:string|null };
export type CupMatch = CupMatchLike & { playedOn?:string };
type ClubSettings = HandicapSettings & { start:number };
type State = { players?:Player[]; matches?:CupMatch[]; tournaments?:TournamentLike[]; settings?:ClubSettings };

/* A shared link is read by people who are not in the club's WhatsApp group and have never seen the
   leaderboard, so the roster carries the two numbers that answer the question they are actually
   asking — "is this field beatable by me" — rather than a list of names they may not recognise.
   Both come from `lib/handicap`, the same source the leaderboard and the match form read. */
const DEFAULT_SETTINGS:ClubSettings={conversion:1,curvature:1.25,handicapSoftCap:800,start:1500};

export async function loadCupShare(id:string){
  const raw=await getState().catch(()=>null);
  if(!raw)return null;
  let state:State;
  try{ state=JSON.parse(raw) as State; }catch{ return null; }
  const tournament=(state.tournaments??[]).find(item=>item.id===id);
  if(!tournament)return null;
  const closed=signupsClosed(tournament);
  const bracket=closed?buildBracket<CupMatch>(tournament,state.matches??[]):null;
  const player=(playerId:string)=>(state.players??[]).find(item=>item.id===playerId);
  const entrants=tournament.signups?.length??0;
  const share=cupShareState({
    signupDeadline:tournament.signupDeadline,entrants,closed,
    drew:Boolean(bracket?.size),
    roundName:currentRoundLabel(bracket),
    championName:bracket?.champion?player(bracket.champion)?.name:"",
  });
  const players=state.players??[];
  const settings={...DEFAULT_SETTINGS,...(state.settings??{})};
  const rated=players.map(entry=>({rating:entry.rating??settings.start,handicap:null}));
  const ratingOf=(playerId:string)=>players.find(entry=>entry.id===playerId)?.rating??null;
  /** One entrant's numbers, or nulls for a player the club has never rated. */
  const standing=(playerId:string)=>{
    const rating=ratingOf(playerId);
    if(rating==null)return {rating:null,handicap:null};
    return {rating:Math.round(rating),handicap:suggestedHandicap({rating,handicap:null},rated,settings)};
  };
  /** What the two sides of a tie should play off. Quoted only where the cup actually applies it —
      a handicap printed beside a tie in a level cup would be a number nobody plays to. */
  const tieHandicap=(a:string,b:string)=>{
    if(tournament.handicapMode!=="suggested")return "";
    const [left,right]=[ratingOf(a),ratingOf(b)];
    if(left==null||right==null)return "";
    const proposal=proposeHandicap(left,right,settings);
    return proposal.points===0?"平手":`讓 ${Math.abs(proposal.points)} 分`;
  };
  return {tournament,bracket,share,player,players,settings,standing,tieHandicap};
}
