// iOS Safari never fires `beforeinstallprompt`, so the only path to an installed
// app is teaching the share-sheet gesture. That guidance is only ever useful to a
// returning iPhone/iPad member browsing in Safari itself, and it must be mutable
// for good — nobody should be nagged about installing an app they don't want.
export const A2HS_STORAGE_KEY="a2hs-ios";
export const A2HS_SNOOZE_DAYS=14;
export const A2HS_VISITS_BEFORE_PROMPT=2;

export type A2hsState={visits:number;snoozeUntil:number;never:boolean};

export const emptyA2hsState=():A2hsState=>({visits:0,snoozeUntil:0,never:false});

export function parseA2hsState(raw:string|null):A2hsState{
  if(!raw)return emptyA2hsState();
  try{
    const parsed=JSON.parse(raw) as Partial<A2hsState>;
    return {visits:Number(parsed.visits)||0,snoozeUntil:Number(parsed.snoozeUntil)||0,never:Boolean(parsed.never)};
  }catch{return emptyA2hsState()}
}

// Chrome/Firefox/Edge and in-app webviews on iOS either hide "加入主畫面" or cannot
// install at all, so the walkthrough would be wrong for them.
const IOS_NON_SAFARI=/CriOS|FxiOS|EdgiOS|OPiOS|Line\/|FBAN|FBAV|Instagram|MicroMessenger/;

export function isIosSafari({userAgent,platform="",maxTouchPoints=0}:{userAgent:string;platform?:string;maxTouchPoints?:number}):boolean{
  const iPadOS=platform==="MacIntel"&&maxTouchPoints>1; // iPadOS 13+ masquerades as a Mac
  if(!/iPhone|iPod|iPad/.test(userAgent)&&!iPadOS)return false;
  return !IOS_NON_SAFARI.test(userAgent);
}

export function shouldPromptAddToHomeScreen({state,visits,now}:{state:A2hsState;visits:number;now:number}):boolean{
  if(state.never)return false;
  if(now<state.snoozeUntil)return false;
  return visits>=A2HS_VISITS_BEFORE_PROMPT;
}

export function dismissA2hs(state:A2hsState,never:boolean,now:number):A2hsState{
  return {...state,never,snoozeUntil:never?0:now+A2HS_SNOOZE_DAYS*864e5};
}
