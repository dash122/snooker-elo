"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type EventCount = { event:string; count:number; players:number };
export type EventDailyPoint = { date:string; members:number; triggers:number };
export type EventMemberDetail = {
  playerId:string;
  name:string;
  initials:string;
  colour:string|null;
  count:number;
  activeDays:number;
  firstAt:string;
  lastAt:string;
};

type EventAnalyticsProps = {
  counts:EventCount[];
  activeDays:number;
  selectedEvent:string|null;
  daily:EventDailyPoint[];
  members:EventMemberDetail[];
};

function reportHref(days:number,event:string){
  const params=new URLSearchParams({window:String(days),event});
  return `/admin/reports?${params.toString()}`;
}

const WEEKDAYS=["日","一","二","三","四","五","六"] as const;

function calendarDate(date:string){
  const [year,month,day]=date.split("-").map(Number);
  const valid=Number.isFinite(year)&&Number.isFinite(month)&&Number.isFinite(day);
  if(!valid)return null;
  const weekday=WEEKDAYS[new Date(Date.UTC(year,month-1,day)).getUTCDay()];
  return {year,month,day,weekday};
}

// Keep first-render strings independent of the server/browser ICU locale data.
const dateLabel=(date:string)=>{
  const value=calendarDate(date);
  return value?`${value.month}/${value.day}`:date;
};
const dateLongLabel=(date:string)=>{
  const value=calendarDate(date);
  return value?`${value.year}年${value.month}月${value.day}日（週${value.weekday}）`:date;
};
const dateTimeLabel=(value:string)=>{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "—";
  const hongKong=new Date(date.getTime()+8*60*60*1000);
  const pad=(part:number)=>String(part).padStart(2,"0");
  return `${hongKong.getUTCMonth()+1}/${hongKong.getUTCDate()} ${pad(hongKong.getUTCHours())}:${pad(hongKong.getUTCMinutes())}`;
};

function EventTrendChart({event,points}:{event:string;points:EventDailyPoint[]}){
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const width=760,height=280;
  const pad={top:24,right:18,bottom:48,left:48};
  const innerWidth=width-pad.left-pad.right;
  const innerHeight=height-pad.top-pad.bottom;
  const maxValue=Math.max(0,...points.map(point=>point.members));
  const step=maxValue<=4?1:Math.max(1,Math.ceil(maxValue/4));
  const yMax=Math.max(1,step*(maxValue<=4?maxValue:4));
  const xAt=(index:number)=>points.length<=1?pad.left+innerWidth/2:pad.left+(index/(points.length-1))*innerWidth;
  const yAt=(value:number)=>pad.top+innerHeight-(value/yMax)*innerHeight;
  const line=points.map((point,index)=>`${xAt(index)},${yAt(point.members)}`).join(" ");
  const area=points.length?`M ${xAt(0)} ${pad.top+innerHeight} L ${points.map((point,index)=>`${xAt(index)} ${yAt(point.members)}`).join(" L ")} L ${xAt(points.length-1)} ${pad.top+innerHeight} Z`:"";
  const labelEvery=points.length>45?Math.ceil(points.length/6):points.length>20?Math.ceil(points.length/7):1;
  const active=activeIndex===null?null:points[activeIndex];
  const activeLeft=activeIndex===null?50:Math.min(88,Math.max(12,(xAt(activeIndex)/width)*100));
  const activeTop=activeIndex===null?24:Math.max(24,(yAt(points[activeIndex].members)/height)*100);

  return <div className="reports-chart" onMouseLeave={()=>setActiveIndex(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby="reports-chart-title reports-chart-desc">
      <title id="reports-chart-title">{`${event} 每日觸發會員`}</title>
      <desc id="reports-chart-desc">X 軸為香港日期，Y 軸為當日曾觸發此事件的獨立會員人數。</desc>
      {Array.from({length:yMax<=4?yMax+1:5},(_,index)=>{
        const value=yMax<=4?index:index*step;
        return <g key={value} className="reports-chart-gridline">
          <line x1={pad.left} x2={width-pad.right} y1={yAt(value)} y2={yAt(value)}/>
          <text x={pad.left-10} y={yAt(value)+4} textAnchor="end">{value}</text>
        </g>;
      })}
      <line className="reports-chart-axis" x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top+innerHeight}/>
      <line className="reports-chart-axis" x1={pad.left} x2={width-pad.right} y1={pad.top+innerHeight} y2={pad.top+innerHeight}/>
      {points.map((point,index)=>index%labelEvery===0||index===points.length-1?<text key={point.date} className="reports-chart-x-label" x={xAt(index)} y={height-18} textAnchor={index===0?"start":index===points.length-1?"end":"middle"}>{dateLabel(point.date)}</text>:null)}
      {area&&<path className="reports-chart-area" d={area}/>} 
      {line&&<polyline className="reports-chart-line" points={line}/>} 
      {points.map((point,index)=><circle
        key={point.date}
        className={`reports-chart-point${activeIndex===index?" active":""}`}
        cx={xAt(index)} cy={yAt(point.members)} r={activeIndex===index?5:3.5}
        tabIndex={0}
        role="button"
        aria-label={`${dateLongLabel(point.date)}：${point.members} 位會員，${point.triggers} 次觸發`}
        onMouseEnter={()=>setActiveIndex(index)}
        onFocus={()=>setActiveIndex(index)}
        onBlur={()=>setActiveIndex(null)}
        onKeyDown={keyboardEvent=>{
          if(keyboardEvent.key==="Enter"||keyboardEvent.key===" "){keyboardEvent.preventDefault();setActiveIndex(index)}
        }}
      />)}
    </svg>
    {active&&<div className="reports-chart-tooltip" style={{left:`${activeLeft}%`,top:`${activeTop}%`}} role="status">
      <strong>{dateLongLabel(active.date)}</strong>
      <span>{active.members} 位會員</span>
      <small>{active.triggers} 次觸發</small>
    </div>}
    <p className="sr-only" aria-live="polite">{active?`${dateLongLabel(active.date)}：${active.members} 位會員，${active.triggers} 次觸發`:""}</p>
    <table className="sr-only">
      <caption>{event} 每日觸發會員數據</caption>
      <thead><tr><th scope="col">日期</th><th scope="col">會員數</th><th scope="col">觸發次數</th></tr></thead>
      <tbody>{points.map(point=><tr key={point.date}><th scope="row">{dateLongLabel(point.date)}</th><td>{point.members}</td><td>{point.triggers}</td></tr>)}</tbody>
    </table>
  </div>;
}

type MemberSortKey="count"|"activeDays"|"firstAt"|"lastAt";
type MemberSort={key:MemberSortKey;direction:"asc"|"desc"};
const MEMBER_PAGE_SIZE=25;

function compareMemberNames(left:string,right:string){
  if(left===right)return 0;
  return left<right?-1:1;
}

function MemberDetailTable({members}:Pick<EventAnalyticsProps,"members">){
  const [sort,setSort]=useState<MemberSort>({key:"count",direction:"desc"});
  const [page,setPage]=useState(0);
  const totalTriggers=members.reduce((sum,member)=>sum+member.count,0);
  const ordered=useMemo(()=>[...members].sort((a,b)=>{
    const left=sort.key==="firstAt"||sort.key==="lastAt"?Date.parse(a[sort.key]):a[sort.key];
    const right=sort.key==="firstAt"||sort.key==="lastAt"?Date.parse(b[sort.key]):b[sort.key];
    const comparison=typeof left==="number"&&typeof right==="number"?left-right:compareMemberNames(String(left),String(right));
    return (sort.direction==="asc"?1:-1)*comparison||compareMemberNames(a.name,b.name);
  }),[members,sort]);
  const toggleSort=(key:MemberSortKey)=>{
    setPage(0);
    setSort(current=>current.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:key==="firstAt"?"asc":"desc"});
  };
  const sortLabel=(key:MemberSortKey)=>sort.key===key?(sort.direction==="asc"?"升序":"降序"):"";
  const sortValue=(key:MemberSortKey)=>sort.key===key?(sort.direction==="asc"?"ascending":"descending"):undefined;
  const pageCount=Math.max(1,Math.ceil(ordered.length/MEMBER_PAGE_SIZE));
  const currentPage=Math.min(page,pageCount-1);
  const visibleMembers=ordered.slice(currentPage*MEMBER_PAGE_SIZE,(currentPage+1)*MEMBER_PAGE_SIZE);

  return <div className="reports-members-wrap">
    {members.length===0
      ? <div className="reports-detail-empty"><span aria-hidden="true">◇</span><strong>此期間沒有已連結會員</strong><p>此事件可能只有匿名觸發，或所選期間內沒有會員觸發。</p></div>
      : <>
        <div className="reports-members-count">顯示 {members.length} 位會員</div>
        <div className="reports-member-table-wrap">
          <table className="reports-member-table">
            <caption className="sr-only">觸發 {members.length} 位會員的詳細統計</caption>
            <thead><tr>
              <th scope="col">會員</th>
              <th scope="col" aria-sort={sortValue("count")}><button type="button" onClick={()=>toggleSort("count")}>觸發次數 <span aria-hidden="true">{sortLabel("count")?sort.direction==="asc"?"↑":"↓":"↕"}</span></button></th>
              <th scope="col" aria-sort={sortValue("activeDays")}><button type="button" onClick={()=>toggleSort("activeDays")}>活躍日數 <span aria-hidden="true">{sortLabel("activeDays")?sort.direction==="asc"?"↑":"↓":"↕"}</span></button></th>
              <th scope="col" aria-sort={sortValue("firstAt")}><button type="button" onClick={()=>toggleSort("firstAt")}>首次觸發 <span aria-hidden="true">{sortLabel("firstAt")?sort.direction==="asc"?"↑":"↓":"↕"}</span></button></th>
              <th scope="col" aria-sort={sortValue("lastAt")}><button type="button" onClick={()=>toggleSort("lastAt")}>最近觸發 <span aria-hidden="true">{sortLabel("lastAt")?sort.direction==="asc"?"↑":"↓":"↕"}</span></button></th>
              <th scope="col">佔會員觸發</th>
            </tr></thead>
            <tbody>{visibleMembers.map(member=>{
              const share=totalTriggers?Math.round(member.count/totalTriggers*100):0;
              return <tr key={member.playerId}>
                <td data-label="會員"><span className="reports-member-person"><i style={member.colour?{backgroundColor:member.colour}:undefined}>{member.initials}</i><b>{member.name}</b></span></td>
                <td data-label="觸發次數" className="reports-number">{member.count}</td>
                <td data-label="活躍日數" className="reports-number">{member.activeDays}</td>
                <td data-label="首次觸發"><time dateTime={member.firstAt}>{dateTimeLabel(member.firstAt)}</time></td>
                <td data-label="最近觸發"><time dateTime={member.lastAt}>{dateTimeLabel(member.lastAt)}</time></td>
                <td data-label="佔會員觸發" className="reports-number">{share}%</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {pageCount>1&&<nav className="reports-pagination" aria-label="會員頁面">
          <button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一頁</button>
          <span>第 {currentPage+1}／{pageCount} 頁</span>
          <button type="button" disabled={currentPage===pageCount-1} onClick={()=>setPage(currentPage+1)}>下一頁</button>
        </nav>}
      </>}
  </div>;
}

export function EventAnalytics({counts,activeDays,selectedEvent,daily,members}:EventAnalyticsProps){
  const router=useRouter();
  const [isPending,startTransition]=useTransition();
  if(!selectedEvent)return null;
  const totalTriggers=members.reduce((sum,member)=>sum+member.count,0);
  const uniqueMembers=members.length;
  const average=uniqueMembers?totalTriggers/uniqueMembers:0;
  const peakMembers=Math.max(0,...daily.map(point=>point.members));
  const selectEvent=(event:string)=>startTransition(()=>router.push(reportHref(activeDays,event)));

  return <section className="reports-event-workspace" aria-labelledby="reports-detail-title">
    <div className="reports-detail-head">
      <div>
        <h2 id="reports-detail-title">事件詳情</h2>
        <p>查看此事件在香港日期的會員趨勢，以及每位會員的觸發次數。</p>
      </div>
      <label className="reports-event-picker"><span>選擇事件</span><select value={selectedEvent} disabled={isPending} aria-busy={isPending||undefined} onChange={event=>selectEvent(event.target.value)}>{counts.map(row=><option key={row.event} value={row.event}>{row.event}</option>)}</select></label>
    </div>

    <div className="reports-event-summary" aria-label="事件摘要">
      <div><small>觸發會員</small><strong>{uniqueMembers}</strong><span>位獨立會員</span></div>
      <div><small>會員觸發次數</small><strong>{totalTriggers}</strong><span>不包括匿名</span></div>
      <div><small>平均每位</small><strong>{average?average.toFixed(1):"—"}</strong><span>次觸發</span></div>
      <div><small>每日最高</small><strong>{peakMembers}</strong><span>位會員</span></div>
    </div>

    <div className="reports-trend-panel">
      <div className="reports-panel-heading"><div><h3>每日觸發會員</h3><p>{activeDays} 日內，每日曾觸發 <code>{selectedEvent}</code> 的獨立會員數。</p></div><span className="reports-panel-key"><i aria-hidden="true"/>獨立會員</span></div>
      <EventTrendChart event={selectedEvent} points={daily}/>
    </div>

    <div className="reports-member-panel">
      <div className="reports-panel-heading"><div><h3>觸發會員</h3><p>只顯示與會員帳戶連結的活動；匿名觸發不會出現在名單。</p></div></div>
      <MemberDetailTable members={members}/>
    </div>
  </section>;
}
