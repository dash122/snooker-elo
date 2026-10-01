/** What a cup's link-preview image says.
 *
 *  The thumbnail is the biggest object in a WhatsApp preview and the only part of it a member reads
 *  before deciding whether to look at the words. So it is treated as the poster: one cup name at
 *  poster size, one clock, one crowd count, one instruction — and nothing else competing for the
 *  same glance.
 *
 *  Kept apart from the drawing so the wording is a value that can be tested without rasterising
 *  anything: `app/api/cup-og/[id]/route.tsx` turns this into pixels and adds no copy of its own. */

import type { CupShareState } from "./cup-share";
import { msg } from "./i18n/translate.ts";
import type { Translator } from "./i18n/translate.ts";

export type CupOgCard = {
  /** 報名中 / 進行中 / 已完成 / 未能開賽 — the pill above the name. */
  status:string;
  /** The clock, when there is one to quote. Empty once entries have closed. */
  urgency:string;
  /** True when the deadline is close enough to be drawn in red rather than gold. */
  hot:boolean;
  name:string;
  /** The one line under the name — who is already in, or how far the cup has got. */
  standfirst:string;
  facts:{label:string;value:string}[];
  cta:string;
};

const STATUS:Record<CupShareState["status"],string>={signup:msg("報名中"),live:msg("進行中"),done:msg("已完成"),short:msg("未能開賽")};

export function cupOgCard(t: Translator, name:string,state:CupShareState):CupOgCard {
  const urgency=state.urgency;
  /* 「報名中」 above 「報名開放中」 is the same sentence twice at two sizes. The clock only earns its own
     pill once it says something the status does not — a number of days. */
  const clock=urgency.label===t("報名開放中")?"":urgency.label;
  const base={status:t(STATUS[state.status]),urgency:clock,hot:urgency.hot,name};
  if(state.status==="signup")return {
    ...base,
    standfirst:t("已有 {entrants} 位會友報名，截止即刻抽籤", {entrants: state.entrants}),
    facts:[{label:t("已報名"),value:t("{entrants} 人", {entrants: state.entrants})},{label:t("報名截止"),value:state.deadline}],
    cta:t("撳入去一撳報名 →"),
  };
  if(state.status==="done")return {
    ...base,
    standfirst:t("冠軍 {championName}", {championName: state.championName}),
    facts:[{label:t("參賽"),value:t("{entrants} 人", {entrants: state.entrants})},{label:t("冠軍"),value:state.championName}],
    cta:t("撳入去睇完整對陣圖 →"),
  };
  if(state.status==="short")return {
    ...base,standfirst:t("今屆報名人數不足，未能開賽"),
    facts:[{label:t("報名"),value:t("{entrants} 人", {entrants: state.entrants})}],
    cta:t("撳入去睇球會賽事 →"),
  };
  return {
    ...base,
    standfirst:t("{entrants} 人參賽，打到{roundName}", {entrants: state.entrants, roundName: state.roundName}),
    facts:[{label:t("參賽"),value:t("{entrants} 人", {entrants: state.entrants})},{label:t("賽事階段"),value:state.roundName}],
    cta:t("撳入去睇對陣圖同賽果 →"),
  };
}

/** Every character the image will draw, so the font can be fetched already subset to them.
 *
 *  Noto Sans TC in full is megabytes; a preview crawler that waits on that gets no image at all.
 *  Google's `css2?text=` endpoint returns a face containing only the glyphs asked for — a few
 *  kilobytes — which is why this list has to be exact rather than approximate. */
export function cupOgGlyphs(t: Translator, card:CupOgCard):string {
  const all=[card.status,card.urgency,card.name,card.standfirst,card.cta,t("SNOOKER ELO 盃賽"),
    ...card.facts.flatMap(fact=>[fact.label,fact.value])].join("");
  return [...new Set(all)].join("");
}

/** The largest size that still fits the cup's name on one poster line, and how many lines it needs.
    A cup name is the one string here that must never be abbreviated, so it gives up type size
    first — 「南華會週年盃賽紀念賽」 shrunk is still readable; truncated it is a different cup. */
export function cupOgNameLayout(name:string,maxWidth=840):{size:number;lines:string[]} {
  const width=(text:string,size:number)=>[...text].reduce((sum,character)=>
    sum+((character.codePointAt(0)??0)>0x2e80?size:size*0.56),0);
  for(const size of [104,92,80,70,62,56]){
    if(width(name,size)<=maxWidth)return {size,lines:[name]};
  }
  const size=56,characters=[...name],lines:string[]=[];
  let current="";
  for(const character of characters){
    if(width(current+character,size)>maxWidth&&current){lines.push(current);current=""}
    current+=character;
  }
  if(current)lines.push(current);
  return {size,lines:lines.slice(0,2)};
}
