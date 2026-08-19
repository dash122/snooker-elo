"use client";
import {useEffect,useState} from "react";
import {A2HS_STORAGE_KEY,dismissA2hs,isIosSafari,parseA2hsState,shouldPromptAddToHomeScreen,type A2hsState} from "../../lib/add-to-home-screen";
import {Button} from "./ui/Primitives";
import {Sheet} from "./ui/Overlay";

const read=():A2hsState=>{try{return parseA2hsState(localStorage.getItem(A2HS_STORAGE_KEY))}catch{return {visits:0,snoozeUntil:0,never:false}}};
const write=(state:A2hsState)=>{try{localStorage.setItem(A2HS_STORAGE_KEY,JSON.stringify(state))}catch{}};
const isStandalone=()=>window.matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;

export function AddToHomeScreen(){
  const [open,setOpen]=useState(false);

  useEffect(()=>{
    const {userAgent,platform,maxTouchPoints}=navigator;
    if(!isIosSafari({userAgent,platform,maxTouchPoints})||isStandalone())return;
    const state=read();
    const visits=state.visits+1;
    write({...state,visits});
    if(!shouldPromptAddToHomeScreen({state,visits,now:Date.now()}))return;
    const timer=window.setTimeout(()=>setOpen(true),4000); // let the page settle before interrupting
    return()=>window.clearTimeout(timer);
  },[]);

  const close=(never:boolean)=>{write(dismissA2hs(read(),never,Date.now()));setOpen(false)};

  return <Sheet open={open} title="加到主畫面，用得更順手" onClose={()=>close(false)} className="a2hs-sheet">
    <p>加到主畫面後會像 App 一樣全螢幕開啟，開波前一按即到，亦可收到比賽通知。</p>
    <ol className="a2hs-steps">
      <li>按 Safari 底部的分享按鈕 <ShareGlyph/></li>
      <li>選擇「加入主畫面」<span className="a2hs-plus">＋</span></li>
      <li>按右上角「加入」即完成</li>
    </ol>
    <div className="a2hs-actions">
      <Button className="a2hs-primary" onClick={()=>close(false)}>知道了</Button>
      <button className="a2hs-quiet" onClick={()=>close(true)}>不用再提醒我</button>
    </div>
  </Sheet>;
}

function ShareGlyph(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 3l3.5 3.5-1.4 1.4L13 6.8V15h-2V6.8L9.9 7.9 8.5 6.5 12 3z" fill="currentColor"/><path d="M5 10h3v2H6.5v8h11v-8H16v-2h3v12H5V10z" fill="currentColor"/></svg>}
