/** What a shared cup link says about itself.
 *
 *  A link pasted into the club's WhatsApp group is the single best chance this app has to reach a
 *  member who has never opened it, so the preview is treated as a product surface rather than a
 *  side-effect of routing: the title carries the cup, the description carries the one fact that
 *  makes someone tap (how long is left to enter, or who is left in it), and the message text above
 *  the link is written the way a member would actually type it — Cantonese, short, with a reason.
 *
 *  Deliberately importless: this is wording, not bracket maths, and the caller — the share page for
 *  its meta tags, the app for its compose link — hands it the numbers it already has. */

export type CupShareState = {
  status:"signup"|"live"|"done"|"short";
  entrants:number;
  deadline:string;
  roundName:string;
  championName:string;
  /** Whole days between now and the deadline, floored, and never negative. 0 means "closes today",
      which is the one number in this module that changes the copy's temperature. */
  daysLeft:number;
  /** The clock, already read. Carried on the state rather than derived by each caller so the button,
      the message, the page badge and the poster can never quote different urgencies. */
  urgency:{label:string;hot:boolean};
};

export type CupShareInput = {
  signupDeadline:string;
  entrants:number;
  closed:boolean;
  /** False when the cup closed without enough entrants to draw a bracket. */
  drew:boolean;
  roundName:string;
  championName?:string;
  now?:number;
};

const dateText=(value:string)=>value.replace("T"," ").slice(0,16);
const DAY=86400000;

/** Days to the deadline. A naive `2026-08-20T23:59` is read as club-local time, exactly the way
    `signupsClosed` reads it, so the two can never disagree about whether entries are still open. */
function daysUntil(deadline:string,now:number):number {
  const at=new Date(deadline).getTime();
  if(!Number.isFinite(at))return 0;
  return Math.max(0,Math.floor((at-now)/DAY));
}

export function cupShareState(input:CupShareInput):CupShareState {
  const status=!input.closed?"signup":!input.drew?"short":input.championName?"done":"live";
  const daysLeft=daysUntil(input.signupDeadline,input.now??Date.now());
  return {
    status,entrants:input.entrants,
    deadline:dateText(input.signupDeadline),
    roundName:input.roundName,
    championName:input.championName??"",
    daysLeft,urgency:urgencyFor(status,daysLeft),
  };
}

/** The one line that gives a recruiting share its temperature.
 *
 *  A share that says only "entries are open" reads the same on the first day and the last, so it is
 *  ignored on both. The clock is the only honest source of urgency a cup has — the club sets a
 *  deadline, and after it there is no way in — so it is quoted plainly and gets louder as it nears.
 *  Nothing here invents scarcity the club did not declare. */
function urgencyFor(status:CupShareState["status"],daysLeft:number):{label:string;hot:boolean} {
  if(status!=="signup")return {label:"",hot:false};
  if(daysLeft===0)return {label:"今日最後召集",hot:true};
  if(daysLeft===1)return {label:"仲有 1 日截止",hot:true};
  if(daysLeft<=3)return {label:`仲有 ${daysLeft} 日截止`,hot:true};
  if(daysLeft<=7)return {label:`仲有 ${daysLeft} 日截止`,hot:false};
  return {label:"報名開放中",hot:false};
}

export function cupUrgency(state:CupShareState):{label:string;hot:boolean} {
  return state.urgency;
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
     entries close, and the field is finite. The deadline in front of it is the part that moves. */
  if(state.status==="signup")return `${state.urgency.label} · 名額有限，已有 ${state.entrants} 人報名。撳入去一撳報名，抽籤即刻有對手。`;
  if(state.status==="done")return `${state.entrants} 人參賽，冠軍 ${state.championName}。撳入去睇完整對陣圖同賽果。`;
  if(state.status==="short")return "今屆報名人數不足，未能開賽。";
  return `${state.entrants} 人參賽，打到${state.roundName}。撳入去睇對陣圖、賽果同下一場。`;
}

/** The text a member sends. Ends with the bare URL on its own line: WhatsApp only renders the link
    preview when the URL is the last thing in the message, and the preview *is* the pitch. */
export function cupShareMessage(name:string,state:CupShareState,url:string):string {
  const lead=state.status==="signup"
    /* The cup's own name is the first thing on the first line, because in a group chat that name is
       what a member recognises — not the app's. Then the clock, then the crowd already in it, then
       one instruction. Four short lines: any longer and WhatsApp collapses it behind 「閱讀更多」,
       which hides the ask. */
    ?[`🏆 ${name}｜${state.urgency.label}`,
      `🎱 已有 ${state.entrants} 位會友報名，${state.deadline} 截止`,
      "截止即刻抽籤，人人有對手，唔使自己搵人。",
      "撳個連結就報到名 👇"]
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

/** What the share button says.
 *
 *  「分享」 is a verb with no object: it tells a member what the button does mechanically and nothing
 *  about why they would press it. While a cup is recruiting the button has one job — get another
 *  member into the draw — so it names the destination the tap actually ends in (WhatsApp, where the
 *  club's group already is) and the outcome it is for. */
export function cupShareCta(state:CupShareState):{label:string;hint:string} {
  if(state.status==="signup")return {
    label:"WhatsApp 叫人一齊報名",
    hint:"貼入球會群組，會友撳個連結就報到名 — 唔使登入都睇到。",
  };
  if(state.status==="done")return {label:"WhatsApp 分享賽果",hint:"畀成個群組睇吓今屆冠軍係邊個。"};
  if(state.status==="short")return {label:"WhatsApp 分享盃賽",hint:"叫多幾個人留意下屆。"};
  return {label:"WhatsApp 分享賽程",hint:"畀群組追住睇對陣圖，睇邊個入決賽。"};
}

/** The link-preview image for one cup.
 *
 *  Drawn per cup rather than served from `public/`, because the thumbnail is the largest thing in a
 *  WhatsApp preview and a generic one wastes it: the cup's own name, the clock and the entry count
 *  belong in the picture, not only in the text underneath. `v` is the cache key — WhatsApp caches a
 *  preview per URL, so the image URL has to change when the facts on it do, or the group keeps
 *  seeing yesterday's count. */
export function cupOgImageUrl(origin:string,id:string,state:CupShareState):string {
  const version=`${state.status}-${state.entrants}-${state.daysLeft}`;
  return `${origin.replace(/\/$/,"")}/api/cup-og/${encodeURIComponent(id)}?v=${version}`;
}

/** The absolute URL a share needs. Relative links are useless in a WhatsApp message, and the origin
    differs between the preview deployment and production, so it is read from the request rather
    than hard-coded. */
export function cupShareUrl(origin:string,id:string):string {
  return `${origin.replace(/\/$/,"")}/c/${id}`;
}
