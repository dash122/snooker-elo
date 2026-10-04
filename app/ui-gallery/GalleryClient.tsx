"use client";
import SessionCard from "../play/SessionCard";
import type { SessionDto } from "../../lib/play/dashboard";
import {useId,useState} from "react";
import {Button,Chip,ChipRow,EmptyState,FormField,InlineNotice,SegmentedControl,Skeleton,StatTile,Surface} from "../components/ui/Primitives";
import {BackdropSheet,ConfirmDialog,Dialog,Sheet} from "../components/ui/Overlay";
import {TabList,TabPanel} from "../components/ui/Tabs";
import {Menu} from "../components/ui/Menu";
import {AppHeader} from "../components/shell/AppHeader";
import {PageHero} from "../components/shell/AppShell";
export default function GalleryClient(){const [segment,setSegment]=useState("ranking"),[dialog,setDialog]=useState(false),[sheet,setSheet]=useState(false);return <main className="ds-gallery"><PageHero eyebrow="INTERNAL DESIGN SYSTEM" title="Snooker ELO UI Gallery" description="PR 1 primitives, states and responsive contracts." action={<Button onClick={()=>setSheet(true)}>Open sheet</Button>}/><section><h2>Buttons</h2><p>主要動作用品牌綠（與現有 190 個 <code>.primary</code> 按鈕一致）；金色保留給精選時刻，例如冠軍、邀請等強調場合。</p><div className="ds-gallery-row"><Button>主要動作</Button><Button variant="featured">精選動作</Button><Button variant="secondary">次要動作</Button><Button variant="quiet">Quiet</Button><Button variant="danger">刪除</Button><Button loading>儲存</Button><Button disabled>不可使用</Button></div></section><section><h2>Surfaces</h2><div className="ds-gallery-grid"><Surface><b>Functional surface</b><p>適合資料密集內容與長時間操作。</p></Surface><Surface tone="raised"><b>Raised surface</b><p>用於需要與背景分離的工作區。</p></Surface><Surface tone="featured"><b>Featured moment</b><p>只用於最值得加入的球局、冠軍與身份時刻。</p></Surface></div></section><section><h2>Controls and forms</h2><SegmentedControl label="排行榜視圖" value={segment} onChange={setSegment} items={[{value:"ranking",label:"目前排名"},{value:"breaks",label:"最高單桿紀錄"},{value:"recent",label:"近三十日統計"}]}/><div className="ds-gallery-grid"><FormField label="球員名稱" hint="同時測試中文及 English labels"><input defaultValue="一個非常非常長的球員名稱 Alexander"/></FormField><FormField label="ELO" error="請輸入有效評分"><input inputMode="numeric" defaultValue="15000"/></FormField></div></section><section><h2>Stat tiles</h2><p>用於 admin/帳戶/球員頁面的數字＋標籤方格，取代原本各頁重複的 <code>&lt;small&gt;/&lt;b&gt;</code> 標記。</p><div className="ds-gallery-row"><StatTile label="活躍球員" value={128}/><StatTile label="本月比賽" value={42}/><StatTile className="warn" label="未連結帳戶" value={3}/></div></section><section><h2>Chip row</h2><p>用於球局卡片的條件標籤列，取代 marketplace／分享頁各自重複的 <code>chips.map(...)</code> 標記。</p><ChipRow items={["要讓分","無煙","水平接近"]}/></section><section><h2>Chip tones</h2><p>單一狀態標籤，取代 <code>.cup-chip</code>／<code>.players-chip</code>／<code>.profile-chip</code>／<code>.admin-chip</code> 等各頁各自重複的標籤樣式。</p><div className="ds-gallery-row"><Chip>一般</Chip><Chip tone="accent">精選</Chip><Chip tone="success">已確認</Chip><Chip tone="warning">待處理</Chip><Chip tone="danger">已取消</Chip></div></section><section><h2>System states</h2><div className="ds-gallery-stack"><InlineNotice tone="success" title="已同步">所有資料已儲存到共用資料庫。</InlineNotice><InlineNotice tone="warning" title="未儲存">離開後變更會消失。</InlineNotice><EmptyState title="目前未有可加入的球局" description="公開你的時間，或稍後回來查看其他球員的時段。" action={<Button onClick={()=>setDialog(true)}>公開時間</Button>}/><Surface><Skeleton width="42%" height="1.25rem"/><br/><Skeleton/><br/><Skeleton width="72%"/></Surface></div></section><SessionCardExamples/><MenuExamples/><SelectionExamples/><OverlayExamples/><Dialog open={dialog} onClose={()=>setDialog(false)} title="公開時間"><p>Dialog focus and escape-key baseline.</p><Button onClick={()=>setDialog(false)}>完成</Button></Dialog><Sheet open={sheet} onClose={()=>setSheet(false)} title="記錄比賽"><p>Mobile sheet respects the visual viewport and safe area. Tab stays inside; Escape restores focus to the opener.</p><Button disabled>Disabled control is skipped</Button><FormField label="最終比分" hint="Tab / Shift+Tab 可在面板內移動。"><input inputMode="numeric" defaultValue="3"/></FormField></Sheet></main>}


function OverlayExamples(){
  const [legacy,setLegacy]=useState(false),[confirm,setConfirm]=useState(false),[nested,setNested]=useState(false);
  const [busy,setBusy]=useState(false),[empty,setEmpty]=useState(false),[text,setText]=useState(""),[long,setLong]=useState(false);
  return <section><h2>對話框與面板</h2><p>Tab 焦點留在最上層；Escape 關閉最上層，然後返回開啟按鈕。處理中不能關閉。</p>
    <div className="ds-gallery-row"><Button type="button" onClick={()=>setLegacy(true)}>開啟舊版面板</Button><Button type="button" onClick={()=>setEmpty(true)}>開啟無可操作內容的確認框</Button></div>
    {legacy&&<BackdropSheet shellClassName="match-entry-sheet" labelledBy="gallery-legacy-title" onClose={()=>!busy&&setLegacy(false)}><h2 id="gallery-legacy-title">面板焦點與輸入</h2><FormField label="備註"><input value={text} onChange={event=>setText(event.target.value)}/></FormField><div className="ds-gallery-stack"><Button type="button" disabled>不可使用</Button><Button type="button" hidden>隱藏操作</Button><Button type="button" onClick={()=>setBusy(value=>!value)}>{busy?"結束處理中狀態":"模擬處理中狀態"}</Button><Button type="button" onClick={()=>setLong(value=>!value)}>{long?"收起長表單":"展開長表單"}</Button>{long&&Array.from({length:12},(_,index)=><FormField key={index} label={`測試欄位 ${index+1}`} hint="測試長表單捲動與鍵盤操作。"><input/></FormField>)}<Button type="button" onClick={()=>setConfirm(true)}>開啟上層確認框</Button></div>
      {confirm&&<ConfirmDialog kicker="確認" title="保留面板內容？" titleId="gallery-confirm" description="關閉此確認框後，備註與處理狀態會保留。" onClose={()=>setConfirm(false)}><Button type="button" disabled>不可使用</Button><Button type="button" onClick={()=>setNested(true)}>再開啟面板</Button><Button type="button" onClick={()=>setConfirm(false)}>返回</Button></ConfirmDialog>}
      {nested&&<Sheet open title="最上層面板" onClose={()=>setNested(false)}><FormField label="鍵盤測試"><input placeholder="Tab / Shift+Tab"/></FormField><Button type="button" onClick={()=>setNested(false)}>返回確認框</Button></Sheet>}
    </BackdropSheet>}
    {empty&&<ConfirmDialog kicker="焦點測試" title="沒有可操作內容" titleId="gallery-empty" description="焦點停留在確認框；按 Escape 或背景返回。" onClose={()=>setEmpty(false)}><Button type="button" disabled>不可使用</Button></ConfirmDialog>}
  </section>;
}


function SelectionExamples(){
  const tabsId=useId();
  const [choice,setChoice]=useState("all"),[view,setView]=useState("history");
  const items=[{value:"history",label:"賽事記錄"},{value:"pending",label:"載入中",disabled:true},{value:"calendar",label:"日曆"},{value:"matrix",label:"對賽矩陣與非常長的中文標籤"}];
  return <section><h2>篩選與分頁</h2><p>篩選按鈕逐個以 Tab 移動；分頁以左右箭嘴、Home、End 切換，跳過不可用項目。</p>
    <SegmentedControl label="示範賽果篩選" value={choice} onChange={setChoice} items={[{value:"all",label:"全部"},{value:"win",label:"勝"},{value:"loss",label:"負",disabled:true}]}/>
    <p role="status">目前篩選：{choice==="all"?"全部":"勝"}</p>
    <TabList id={tabsId} className="ds-toggle-control" label="示範比賽資料檢視" value={view} onChange={setView} items={items}/>
    {items.map(item=><TabPanel key={item.value} id={tabsId} value={item.value} active={view===item.value}><h3>{item.label}</h3><p>這個分頁的內容。</p><Button type="button" variant="secondary">分頁內操作</Button></TabPanel>)}
  </section>;
}

function MenuExamples(){const [selected,setSelected]=useState("all");return <section><h2>帳戶與選單</h2>
  <Menu label="導覽與選擇示範" triggerClassName="ds-button ds-button--secondary" trigger={()=> <span>開啟選單</span>} sections={[
    {items:[{key:"gallery",label:"UI Gallery",href:"/ui-gallery"}]},
    {items:[{key:"all",label:"全部",checked:selected==="all",onSelect:()=>setSelected("all")},{key:"official",label:"正式球手",checked:selected==="official",onSelect:()=>setSelected("official")}]},
  ]}/>
  <div className="ds-app-shell"><main><AppHeader user={null} loadStatus="ready" saving={false} onSettings={()=>setSelected("settings")}/>
  <AppHeader user={{displayName:"非常長的會員名稱 Alexander Chan"}} loadStatus="ready" saving onSettings={()=>setSelected("settings")}/>
  <AppHeader user={null} loadStatus="failed" saving={false} onSettings={()=>setSelected("settings")}/></main></div>
</section>}

function SessionCardExamples() {
  const [opened, setOpened] = useState<string | null>(null);
  const base: SessionDto = {
    id: "gallery-forming", createdBy: "alice", venueId: null, city: "hk",
    startAt: "2026-10-04T12:00:00Z", endAt: "2026-10-04T14:00:00Z",
    minPlayers: 2, targetSize: 3, maxPlayers: 3, tableStatus: "walkin", status: "forming",
    note: "歡迎一齊練習長枱，打兩個鐘。", terms: { vibe: { want: "practice", strictness: "prefer" }, fee: { want: "split", strictness: "prefer" } },
    members: [{ player: { id: "alice", name: "陳大文 Alexander Chan", rating: 1520 }, confidence: "in" }, { player: { id: "bob", name: "李小明", rating: 1380 }, confidence: "maybe" }],
    invitees: [], seatsOpen: 2, seatsNeeded: 1, mine: null, block: null, played: null,
  };
  const cards: SessionDto[] = [base,
    { ...base, id: "gallery-full", status: "full", tableStatus: "booked", seatsOpen: 0, seatsNeeded: 0, mine: "in", maxPlayers: 2, members: base.members.map(m => ({ ...m, confidence: "in" })) },
    { ...base, id: "gallery-empty", members: [], terms: {}, note: null, seatsOpen: 3, seatsNeeded: 2, block: "conflict" },
  ];
  return <section><h2>約戰市集卡片</h2><p>示範資料：待成局、已滿員、未有球友及時間衝突。</p>
    <ul className="play-list">{cards.map(session => <SessionCard key={session.id} session={session} venues={[]} tz="Asia/Hong_Kong" viewerId="bob" onOpen={setOpened}/>)}</ul>
    <Sheet open={opened !== null} title="卡片操作示範" onClose={() => setOpened(null)}><p>已開啟約戰詳情。按 Escape 返回卡片。</p></Sheet>
  </section>;
}
