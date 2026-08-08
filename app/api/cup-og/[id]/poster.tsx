/** The poster drawn at the top of a shared cup link.
 *
 *  Kept out of `route.tsx` so it can be rendered and looked at without a request — a design surface
 *  nobody can see before it ships is a design surface nobody checks. `next/og` rasterises it with
 *  satori, so every box that holds more than one child declares `display:flex` explicitly. */

import type { CupOgCard } from "../../../../lib/cup-og";
import { cupOgNameLayout } from "../../../../lib/cup-og";

export const FONT_STACK="Noto Sans TC";

const GOLD="#e8c26a";
const GOLD_DIM="#b98f3e";
const HOT="#ff6b5a";
const ball=(size:number,colour:string,left:number,top:number)=>
  <div style={{position:"absolute",left,top,width:size,height:size,borderRadius:size,background:colour,
    display:"flex",alignItems:"flex-start",justifyContent:"flex-start"}}>
    <div style={{width:size*0.3,height:size*0.3,borderRadius:size,background:"rgba(255,255,255,.34)",
      marginLeft:size*0.2,marginTop:size*0.18}}/>
  </div>;

export function poster(card:CupOgCard){
  const name=cupOgNameLayout(card.name);
  return <div style={{display:"flex",flexDirection:"column",width:"100%",height:"100%",position:"relative",
    background:"linear-gradient(135deg,#0d4433 0%,#0a3125 55%,#05201a 100%)",color:"#fff",padding:"56px 64px",
    justifyContent:"space-between",fontFamily:FONT_STACK}}>

    {/* Decoration only, and kept east of x=1000 — the column `cupOgNameLayout` never lets the cup's
        name reach — because satori paints an absolutely positioned sibling over the text, not under
        it, so a ball that overlaps a name eats a character rather than sitting behind it. */}
    {ball(150,"#a4192a",1018,132)}
    {ball(80,"#f2ede2",1012,300)}
    {ball(58,"#c8a227",1112,392)}

    <div style={{display:"flex",alignItems:"center",gap:18}}>
      <div style={{display:"flex",width:56,height:56,borderRadius:16,background:GOLD,color:"#0a3125",
        alignItems:"center",justifyContent:"center",fontSize:34,fontWeight:900}}>S</div>
      <div style={{display:"flex",fontSize:30,fontWeight:700,letterSpacing:2}}>SCAA SNOOKER</div>
      <div style={{display:"flex",fontSize:26,color:GOLD_DIM,fontWeight:700}}>會友盃</div>
    </div>

    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div style={{display:"flex",gap:14,alignItems:"center"}}>
        <div style={{display:"flex",padding:"10px 26px",borderRadius:999,fontSize:28,fontWeight:700,
          background:"rgba(232,194,106,.16)",border:`2px solid ${GOLD}`,color:GOLD}}>{card.status}</div>
        {card.urgency?<div style={{display:"flex",padding:"10px 26px",borderRadius:999,fontSize:28,fontWeight:900,
          background:card.hot?HOT:"rgba(255,255,255,.08)",
          border:`2px solid ${card.hot?HOT:"rgba(255,255,255,.22)"}`,
          color:card.hot?"#2a0906":"rgba(255,255,255,.86)"}}>{card.urgency}</div>:null}
      </div>

      {/* The cup's own name, at poster size. It is the only string on the card a member in the group
          chat already recognises, so nothing is allowed to outrank it. */}
      <div style={{display:"flex",flexDirection:"column"}}>
        {name.lines.map((line,index)=>
          <div key={index} style={{display:"flex",fontSize:name.size,fontWeight:900,lineHeight:1.14}}>{line}</div>)}
      </div>

      <div style={{display:"flex",fontSize:32,color:"rgba(255,255,255,.78)"}}>{card.standfirst}</div>
    </div>

    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",gap:44}}>
        {card.facts.map((fact,index)=>
          <div key={index} style={{display:"flex",flexDirection:"column",gap:4}}>
            <div style={{display:"flex",fontSize:22,color:"rgba(255,255,255,.5)"}}>{fact.label}</div>
            <div style={{display:"flex",fontSize:38,fontWeight:700,color:GOLD}}>{fact.value}</div>
          </div>)}
      </div>
      <div style={{display:"flex",padding:"16px 34px",borderRadius:999,background:GOLD,color:"#08251c",
        fontSize:30,fontWeight:900}}>{card.cta}</div>
    </div>
  </div>;
}

