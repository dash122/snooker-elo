import type { Metadata } from "next";
import { getCurrentMember } from "../../../db/auth";
import { cupOgImageUrl, cupShareDescription, cupShareTitle, cupShareUrl } from "../../../lib/cup-share";
import { roundLabel } from "../../../lib/tournament";
import { loadCupShare } from "../../cup-share-data";
import { shareOrigin } from "../../share-origin";
import CupShareView, { type SharedCup } from "./CupShareView";
import { getTranslator } from "../../../lib/i18n/server";
import type { Translator } from "../../../lib/i18n/translate";

export const dynamic = "force-dynamic";

/** The link preview *is* the pitch. A cup pasted into the club's WhatsApp group reaches members who
    have never opened the app, so all three tags — title, description and the poster above them — are
    built from the cup's live state: the clock and the crowd while recruiting, the round or the
    champion once it is running. */
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata> {
  const {id}=await params;
  const { locale, t } = await getTranslator();
  const data=await loadCupShare(t, id);
  const site=await shareOrigin();
  if(!data)return {title:t("搵唔到呢個盃賽｜Snooker ELO"),robots:{index:false}};
  const title=cupShareTitle(t, data.tournament.name,data.share);
  const description=cupShareDescription(t, data.share);
  const url=site?cupShareUrl(site,id):undefined;
  /* Per cup, not one banner for all of them: the poster carries this cup's name, its clock and its
     entry count, which is the whole reason a preview earns a second of anyone's attention. */
  const image=site?cupOgImageUrl(site,id,data.share):"/cup-share.jpg";
  return {
    title,description,
    /* WhatsApp reads Open Graph and nothing else; Telegram and iMessage follow the same tags, and the
       Twitter card keeps a summary_large_image rather than falling back to a bare link. */
    openGraph:{title,description,url,type:"website",siteName:"Snooker ELO",locale:locale==="en"?"en_GB":"zh_HK",
      images:[{url:image,width:1200,height:630,alt:t("{name}｜Snooker ELO 盃賽", {name: data.tournament.name})}]},
    twitter:{card:"summary_large_image",title,description,images:[image]},
    alternates:url?{canonical:url}:undefined,
  };
}

export default async function SharedCupPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const { t } = await getTranslator();
  const [member,data,site]=await Promise.all([getCurrentMember(),loadCupShare(t, id),shareOrigin()]);
  if(!data)return <CupShareView cup={null} url="" signedIn={false}/>;
  const {tournament,bracket,share,player,standing,tieHandicap}=data;
  const name=(playerId:string)=>player(playerId)?.name??t("待定");
  const badge=(playerId:string)=>{
    const found=player(playerId);
    return {id:playerId,name:found?.name??"",short:found?.short??"?",colour:found?.colour??null,
      avatar:found?.avatar??null,...standing(playerId)};
  };
  const cup:SharedCup={
    id,name:tournament.name,startAt:tournament.startAt,share,
    roster:(tournament.signups??[]).map(playerId=>({...badge(playerId),arrival:tournament.arrivalTimes?.[playerId]??null})),
    /* Named on the cup, not on each tie: the mode is a property of the competition, and repeating
       「建議讓分」 on sixteen rows would say it fifteen times too often. */
    handicapMode:tournament.handicapMode==="none"?"none":"suggested",
    rounds:bracket?Array.from({length:bracket.rounds},(_,index)=>({
      round:index+1,
      name:roundLabel(t, index+1,bracket.rounds),
      /* Dead slots are kept, not filtered: the chart needs them to hold the tree's shape, and the
         tie list below drops them itself. */
      ties:bracket.slots.filter(slot=>slot.round===index+1).map(slot=>({
        index:slot.index,state:slot.state,
        playedOn:slot.match?.playedOn??"",
        handicap:slot.a&&slot.b?tieHandicap(slot.a,slot.b):"",
        sides:[slot.a,slot.b].map(playerId=>({
          player:playerId?badge(playerId):null,
          score:slot.match&&playerId?(slot.match.a===playerId?slot.match.scoreA:slot.match.b===playerId?slot.match.scoreB:null):null,
          won:Boolean(slot.winner&&slot.winner===playerId),
        })),
        note:slot.state==="bye"?t("{v} 輪空晉級", {v: name(slot.winner)})
          :slot.state==="walkover"?t("{v} 因對手棄權晉級", {v: name(slot.winner)})
          :slot.state==="waiting"?t("等待上一圈賽果")
          :slot.state==="tbd"?t("對陣待定"):"",
      })),
    })):[],
    champion:bracket?.champion?badge(bracket.champion):null,
  };
  return <CupShareView cup={cup} url={site?cupShareUrl(site,id):""} signedIn={Boolean(member?.statePlayerId)}/>;
}
