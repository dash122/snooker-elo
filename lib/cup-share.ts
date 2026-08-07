/** What a shared cup link says about itself.
 *
 *  A link pasted into the club's WhatsApp group is the single best chance this app has to reach a
 *  member who has never opened it, so the preview is treated as a product surface rather than a
 *  side-effect of routing: the title carries the cup, the description carries the one fact that
 *  makes someone tap (places still open, or who is left in it), and the message text above the link
 *  is written the way a member would actually type it — Cantonese, short, with a reason.
 *
 *  Deliberately importless: this is wording, not bracket maths, and the caller — the share page for
 *  its meta tags, the app for its compose link — hands it the numbers it already has. */

export type CupShareState = {
  status:"signup"|"live"|"done"|"short";
  entrants:number;
  deadline:string;
  roundName:string;
  championName:string;
};

export type CupShareInput = {
  signupDeadline:string;
  entrants:number;
  closed:boolean;
  /** False when the cup closed without enough entrants to draw a bracket. */
  drew:boolean;
  roundName:string;
  championName?:string;
};

const dateText=(value:string)=>value.replace("T"," ").slice(0,16);

export function cupShareState(input:CupShareInput):CupShareState {
  return {
    status:!input.closed?"signup":!input.drew?"short":input.championName?"done":"live",
    entrants:input.entrants,
    deadline:dateText(input.signupDeadline),
    roundName:input.roundName,
    championName:input.championName??"",
  };
}

/** The `<title>` / og:title pair. WhatsApp truncates hard, so the cup's own name leads and the
    status rides behind it — never the app name, which tells a reader nothing they want. */
export function cupShareTitle(name:string,state:CupShareState):string {
  const suffix=state.status==="signup"?"報名中"
    :state.status==="done"?"已完成"
    :state.status==="short"?"":state.roundName;
  return suffix?`${name} · ${suffix}`:name;
}

export function cupShareDescription(state:CupShareState):string {
  /* A cup has no declared capacity — the bracket simply rounds up to the next power of two — so a
     specific "3 places left" was a number the club never actually set. 名額有限 says the true thing:
     entries close, and the field is finite. */
  if(state.status==="signup")return `名額有限 · 已有 ${state.entrants} 人報名，${state.deadline} 截止。撳入去報名，睇對陣同賽果。`;
  if(state.status==="done")return `${state.entrants} 人參賽，冠軍 ${state.championName}。撳入去睇完整對陣圖同賽果。`;
  if(state.status==="short")return "今屆報名人數不足，未能開賽。";
  return `${state.entrants} 人參賽，打到${state.roundName}。撳入去睇對陣圖、賽果同下一場。`;
}

/** The text a member sends. Ends with the bare URL on its own line: WhatsApp only renders the link
    preview when the URL is the last thing in the message, and the preview *is* the pitch. */
export function cupShareMessage(name:string,state:CupShareState,url:string):string {
  const lead=state.status==="signup"
    ?[`🏆 ${name} 開始報名喇`,
      `名額有限 · 已有 ${state.entrants} 人報名`,
      `${state.deadline} 截止，截止後即刻抽籤。`,
      "立即報名參加比賽 👇"]
    :state.status==="done"
    ?[`🏆 ${name} 完滿結束`,`冠軍：${state.championName}`,"完整對陣圖同賽果喺呢度 👇"]
    :state.status==="short"
    ?[`🏆 ${name}`,"今屆報名人數不足，未能開賽。"]
    :[`🏆 ${name} 打到${state.roundName}`,`${state.entrants} 人參賽`,"睇下邊個入決賽 👇"];
  return `${lead.join("\n")}\n${url}`;
}

export function whatsappLink(message:string):string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** The absolute URL a share needs. Relative links are useless in a WhatsApp message, and the origin
    differs between the preview deployment and production, so it is read from the request rather
    than hard-coded. */
export function cupShareUrl(origin:string,id:string):string {
  return `${origin.replace(/\/$/,"")}/c/${id}`;
}
