import type { Metadata } from "next";
import { headers } from "next/headers";
import { getCurrentMember } from "../../../db/auth";
import { getState } from "../../../db/state";
import { cupShareDescription, cupShareState, cupShareTitle, cupShareUrl } from "../../../lib/cup-share";
import { bracketShape, buildBracket, currentRoundLabel, roundLabel, signupsClosed, type CupMatchLike, type TournamentLike } from "../../../lib/tournament";
import CupShareView, { type SharedCup } from "./CupShareView";

export const dynamic = "force-dynamic";

type Player = { id:string; name:string; short?:string|null; rating?:number; colour?:string|null; avatar?:string|null };
type CupMatch = CupMatchLike & { playedOn?:string };
type State = { players?:Player[]; matches?:CupMatch[]; tournaments?:TournamentLike[] };

/** Everything the page and its meta tags need, read once. */
async function load(id:string){
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
    /* While recruiting the size is the bracket the current field *would* fill, which is what makes
       "仲有 3 個位" true; once closed it is the real one, and 0 means the cup never drew. */
    bracketSize:closed?bracket?.size??0:bracketShape(Math.max(entrants,2)).size,
    roundName:currentRoundLabel(bracket),
    championName:bracket?.champion?player(bracket.champion)?.name:"",
  });
  return {tournament,bracket,share,player,players:state.players??[]};
}

async function origin(){
  const list=await headers();
  const host=list.get("x-forwarded-host")??list.get("host")??"";
  const protocol=list.get("x-forwarded-proto")??(host.startsWith("localhost")?"http":"https");
  return process.env.NEXT_PUBLIC_SITE_URL||process.env.SITE_URL||(host?`${protocol}://${host}`:"");
}

/** The link preview *is* the pitch. A cup pasted into the club's WhatsApp group reaches members who
    have never opened the app, so the tags are built from the cup's live state — places left and the
    deadline while recruiting, the round or the champion once it is running. */
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata> {
  const {id}=await params;
  const data=await load(id);
  const site=await origin();
  if(!data)return {title:"搵唔到呢個盃賽｜SCAA Snooker",robots:{index:false}};
  const title=cupShareTitle(data.tournament.name,data.share);
  const description=cupShareDescription(data.share);
  const url=site?cupShareUrl(site,id):undefined;
  const image=site?`${site}/cup-share.jpg`:"/cup-share.jpg";
  return {
    title,description,
    /* WhatsApp reads Open Graph and nothing else; Telegram and iMessage follow the same tags, and the
       Twitter card keeps a summary_large_image rather than falling back to a bare link. */
    openGraph:{title,description,url,type:"website",siteName:"SCAA Snooker",locale:"zh_HK",
      images:[{url:image,width:1200,height:630,alt:"SCAA Snooker 球會賽事"}]},
    twitter:{card:"summary_large_image",title,description,images:[image]},
    alternates:url?{canonical:url}:undefined,
  };
}

export default async function SharedCupPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const [member,data,site]=await Promise.all([getCurrentMember(),load(id),origin()]);
  if(!data)return <CupShareView cup={null} url="" signedIn={false}/>;
  const {tournament,bracket,share,player}=data;
  const name=(playerId:string)=>player(playerId)?.name??"待定";
  const badge=(playerId:string)=>{
    const found=player(playerId);
    return {id:playerId,name:found?.name??"",short:found?.short??"?",colour:found?.colour??null,avatar:found?.avatar??null};
  };
  const cup:SharedCup={
    id,name:tournament.name,share,
    roster:(tournament.signups??[]).map(badge),
    rounds:bracket?Array.from({length:bracket.rounds},(_,index)=>({
      round:index+1,
      name:roundLabel(index+1,bracket.rounds),
      ties:bracket.slots.filter(slot=>slot.round===index+1&&slot.state!=="dead").map(slot=>({
        index:slot.index,state:slot.state,
        playedOn:slot.match?.playedOn??"",
        sides:[slot.a,slot.b].map(playerId=>({
          player:playerId?badge(playerId):null,
          score:slot.match&&playerId?(slot.match.a===playerId?slot.match.scoreA:slot.match.b===playerId?slot.match.scoreB:null):null,
          won:Boolean(slot.winner&&slot.winner===playerId),
        })),
        note:slot.state==="bye"?`${name(slot.winner)} 輪空晉級`
          :slot.state==="walkover"?`${name(slot.winner)} 因對手棄權晉級`
          :slot.state==="waiting"?"等待上一圈賽果"
          :slot.state==="tbd"?"對陣待定":"",
      })),
    })):[],
    champion:bracket?.champion?badge(bracket.champion):null,
  };
  return <CupShareView cup={cup} url={site?cupShareUrl(site,id):""} signedIn={Boolean(member?.statePlayerId)}/>;
}
