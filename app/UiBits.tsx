export type SortKey = "rank"|"name"|"rating"|"change"|"form"|"official"|"suggested"|"games"|"winRate"|"frameRate";
export const sortLabels:Record<SortKey,string>={rank:"排名",name:"球員",rating:"ELO",change:"最近變化",form:"近況",official:"正式評分",suggested:"建議評分",games:"場數",winRate:"勝率",frameRate:"局數勝率"};

export function SortControls({sort,dir,onSort}:{sort:SortKey;dir:"asc"|"desc";onSort:(key:SortKey)=>void}) {
  return <div className="sort-controls"><label>排序<select value={sort} onChange={event=>onSort(event.target.value as SortKey)}>{(Object.keys(sortLabels) as SortKey[]).map(key=><option key={key} value={key}>{sortLabels[key]}</option>)}</select></label><button aria-label={dir==="asc"?"目前升序，切換為降序":"目前降序，切換為升序"} onClick={()=>onSort(sort)}>{dir==="asc"?"↑ 升序":"↓ 降序"}</button></div>;
}

export function SortArrow({active,dir}:{active:boolean;dir:"asc"|"desc"}) {
  return <i className={`sort-arrow ${active?"active":""}`} aria-hidden="true">{active?(dir==="asc"?"↑":"↓"):"↕"}</i>;
}

export function Sparkline({values,label}:{values:number[];label:string}) {
  const min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min);
  const points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${28-(v-min)/range*24}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 32" role="img" aria-label={`${label}；由 ${Math.round(values[0])} 至 ${Math.round(values.at(-1)??values[0])}`}><polyline points={points}/><circle cx={values.length===1?50:100} cy={28-((values.at(-1)??min)-min)/range*24} r="2.5"/></svg>;
}

export function LineChart({values,label,lower,upper}:{values:number[];label:string;lower?:number;upper?:number}) {
  const all=[...values,...(lower==null?[]:[lower]),...(upper==null?[]:[upper])],min=Math.min(...all),max=Math.max(...all),range=Math.max(1,max-min);
  const x=(i:number)=>values.length===1?50:4+i/(values.length-1)*92,y=(v:number)=>56-(v-min)/range*48;
  const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
  return <svg className="line-chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={`${label}；最低 ${Math.round(min*100)/100}，最高 ${Math.round(max*100)/100}`}><line x1="4" y1="56" x2="96" y2="56" className="grid-line"/>{lower!=null&&upper!=null&&<rect x="4" y={y(upper)} width="92" height={Math.max(1,y(lower)-y(upper))} className="confidence-band"/>}<polyline points={points}/>{values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r="1.5"><title>{Math.round(v*100)/100}</title></circle>)}</svg>;
}

export function Empty({text,sub}:{text:string;sub:string}) {
  return <div className="empty"><b>○</b><h3>{text}</h3><p>{sub}</p></div>;
}

export function Term({label,tip}:{label:string;tip:string}) {
  return <span className="term" tabIndex={0} aria-label={`${label}：${tip}`}>{label}<i aria-hidden="true">ⓘ</i><span className="term-tip" role="tooltip">{tip}</span></span>;
}

export function PlayerForm({form,setForm,editing,onSave}:{form:any;setForm:any;editing:boolean;onSave:()=>void}) {
  const update=(key:string,value:string)=>setForm((current:any)=>({...current,[key]:value}));
  return <><p className="kicker">公開管理</p><h2>{editing?"編輯球員":"新增球員"}</h2><p className="sub">{editing?"修改起始 ELO 後，系統會按剩餘賽事完整重播評分及近況。":"起始 ELO 留空時使用群組預設值。"}</p><label>顯示名稱<input value={form.name} onChange={event=>update("name",event.target.value)}/></label><label>短名稱／縮寫<input maxLength={3} value={form.short} onChange={event=>update("short",event.target.value)}/></label><label className="initial-elo-field">球員起始 ELO（可編輯）<input data-testid="player-initial-elo" type="number" inputMode="numeric" placeholder="例如 1500" value={form.rating} onChange={event=>update("rating",event.target.value)}/><small>{editing?"儲存後會重算此球員及受影響賽事。":"留空則使用群組預設起始 ELO。"}</small></label><label>正式讓分<input type="number" step="2" value={form.handicap} onChange={event=>update("handicap",event.target.value)}/></label><button className="primary full" onClick={onSave}>{editing?"儲存並重播":"新增球員"}</button></>;
}
