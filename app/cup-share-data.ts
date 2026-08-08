import { getState } from "../db/state";
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
type State = { players?:Player[]; matches?:CupMatch[]; tournaments?:TournamentLike[] };

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
  return {tournament,bracket,share,player,players:state.players??[]};
}
