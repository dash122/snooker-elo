import {addDaysHongKong, hkDate, validateAvailabilityInterval} from "../lib/availability.ts";
import {
  acceptsVenue, avoidsPair, canJoin, marketplaceFormationStatus, marketplaceOpportunities, overlaps,
  parseMatchConditions, parseVenueScope, resolveGroup, validateGroupRange,
  type MarketPool, type Supply, type LiveFormation, type MarketplaceDashboard, type MarketplaceVenue,
  type MatchmakingPairPreference, type FormationMember, type Opportunity, type SessionView,
} from "../lib/matchmaking-marketplace.ts";

export interface MarketConnection { query<T>(sql:string,params?:unknown[]):Promise<T[]> }
export interface MarketDatabase extends MarketConnection { transaction<T>(fn:(connection:MarketConnection)=>Promise<T>):Promise<T> }
export class MarketplaceError extends Error {
  status:number;
  constructor(message:string,status=409){super(message);this.status=status;}
}
const iso=(date:string|Date)=>new Date(date).toISOString();
function fail(message="資料已更新，請重新載入後再試。",status=409):never {throw new MarketplaceError(message,status);}
const fields=`s.id,s.player_id AS "playerId",s.start_at AS "startAt",s.end_at AS "endAt",s.venue_id AS "venueId",
  s.venue_scope AS "venueScope",s.min_players AS "minPlayers",s.target_size AS "targetSize",s.max_players AS "maxPlayers",
  s.commitment,s.conditions,s.source,s.cancelled_at IS NOT NULL AS cancelled,
  jsonb_build_object('id',p.id,'name',p.name,'rating',p.rating::float8) AS player`;

export async function marketplaceReady(db:MarketConnection) {
  const [row]=await db.query<{ready:boolean}>(`SELECT to_regclass('public.matchmaking_delivery') IS NOT NULL
    AND to_regclass('public.matchmaking_results') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='availability_slots' AND column_name='source') AS ready`);
  return row.ready;
}

export async function readPool(db:MarketConnection,now=Date.now()):Promise<MarketPool> {
  const rows=await db.query<Supply>(`SELECT ${fields} FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE p.active AND (NOT EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id)
      OR EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id AND m.active))
    AND s.end_at>$1 AND s.start_at<$2 ORDER BY s.start_at,s.id`,[new Date(now-48*3600000).toISOString(),new Date(now+8*86400000).toISOString()]);
  const slots=rows.map(s=>({...s,startAt:iso(s.startAt),endAt:iso(s.endAt),conditions:s.source==="legacy"
    ?{handicap:s.conditions?.handicap===true,noSmoking:s.conditions?.noSmoking===true,levelStrict:(s.conditions as {levelOnly?:boolean})?.levelOnly===true}
    :parseMatchConditions(s.conditions)}));
  const venues=await db.query<MarketplaceVenue>(`SELECT id,name,district FROM venues WHERE active ORDER BY name,id`);
  const avoids=await db.query<MatchmakingPairPreference>(`SELECT player_id AS "playerId",other_player_id AS "otherPlayerId",preference FROM matchmaking_pair_preferences`);
  const sessions=await db.query<LiveFormation>(`SELECT id,start_at AS "startAt",end_at AS "endAt",venue_id AS "venueId",
    min_players AS "minPlayers",target_size AS "targetSize",max_players AS "maxPlayers",status,source,
    created_by_player_id AS "createdByPlayerId",revision,reopened FROM matchmaking_sessions
    WHERE source<>'legacy' AND status<>'cancelled' AND end_at>$1 ORDER BY start_at,id`,[new Date(now-48*3600000).toISOString()]);
  const members=await db.query<FormationMember & {sessionId:string;eligibility:Supply|null}>(`SELECT m.session_id AS "sessionId",m.player_id AS "playerId",
    m.availability_slot_id AS "availabilitySlotId",m.status,m.eligibility FROM matchmaking_session_members m
    JOIN matchmaking_sessions s ON s.id=m.session_id WHERE s.source<>'legacy' AND s.status<>'cancelled' AND s.end_at>$1`,[new Date(now-48*3600000).toISOString()]);
  const profiles=await db.query<{id:string;name:string;rating:number;active:boolean}>(`SELECT id,name,rating::float8 AS rating,active FROM state_players`);
  for(const s of sessions){
    s.startAt=iso(s.startAt);s.endAt=iso(s.endAt);
    s.members=members.filter(m=>m.sessionId===s.id).map(({playerId,availabilitySlotId,status})=>({playerId,availabilitySlotId,status}));
    s.accepted=members.filter(m=>m.sessionId===s.id&&m.status==="accepted").flatMap(m=>{
      const slot=m.eligibility??slots.find(a=>a.id===m.availabilitySlotId),p=profiles.find(p=>p.id===m.playerId);
      return slot&&p?[{...slot,player:{id:p.id,name:p.name,rating:p.rating}}]:[];
    });
  }
  const conflicts=await db.query<{playerId:string;sessionId:string;startAt:string;endAt:string}>(`SELECT m.player_id AS "playerId",s.id AS "sessionId",s.start_at AS "startAt",s.end_at AS "endAt"
    FROM matchmaking_sessions s JOIN matchmaking_session_members m ON m.session_id=s.id AND m.status='accepted'
    WHERE s.status IN ('playable','full') AND s.end_at>$1
    UNION ALL SELECT p.player_id,'open:'||c.id,c.start_at,c.end_at FROM open_calls c JOIN open_call_players p ON p.call_id=c.id
    WHERE c.status IN ('open','claimed') AND c.end_at>$1 AND (SELECT count(*) FROM open_call_players cp WHERE cp.call_id=c.id)>=2`,[new Date(now).toISOString()]);
  return {slots,venues,avoids,sessions,conflicts:conflicts.map(c=>({...c,startAt:iso(c.startAt),endAt:iso(c.endAt)}))};
}

function publicOpportunity(o:Opportunity):Opportunity {
  return {key:o.key,sessionId:o.sessionId,slotId:o.slotId,startAt:o.startAt,endAt:o.endAt,venueId:o.venueId,
    minPlayers:o.minPlayers,targetSize:o.targetSize,maxPlayers:o.maxPlayers,acceptedPlayers:o.acceptedPlayers,
    compatibleCount:o.compatibleCount,score:Math.round(o.score),hints:o.hints};
}
export async function marketplaceDashboard(db:MarketConnection,viewerId:string|null,signedIn:boolean,date=hkDate(),now=Date.now()):Promise<MarketplaceDashboard> {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<hkDate(new Date(now))||date>addDaysHongKong(hkDate(new Date(now)),6))fail("請選擇未來七日。",400);
  const pool=await readPool(db,now);
  const liveSlots=pool.slots.filter(s=>!s.cancelled&&Date.parse(s.endAt)>now);
  const dates=Array.from({length:7},(_,i)=>{
    const day=addDaysHongKong(hkDate(new Date(now)),i),onDay=liveSlots.filter(s=>hkDate(new Date(s.startAt))===day);
    return {date:day,publicPlayers:new Set(onDay.map(s=>s.playerId)).size,activePlayers:new Set(onDay.filter(s=>s.commitment==="going").map(s=>s.playerId)).size,
      formingGroups:pool.sessions.filter(s=>s.status==="forming"&&hkDate(new Date(s.startAt))===day).length};
  });
  const base={ready:true,signedIn,viewerId,date,dates,venues:pool.venues,mine:[],availability:[],sessions:[],opportunities:[]};
  if(!signedIn)return base;
  const mine=liveSlots.filter(s=>s.playerId===viewerId);
  const availability=liveSlots.filter(s=>s.playerId!==viewerId&&hkDate(new Date(s.startAt))===date
    &&(!viewerId||!avoidsPair(pool,viewerId,s.playerId))).sort((a,b)=>Number(b.commitment==="going")-Number(a.commitment==="going")||a.startAt.localeCompare(b.startAt));
  if(viewerId){
    const history=await db.query<{id:string;recent:number;lifetime:number}>(`SELECT CASE WHEN player_a=$1 THEN player_b ELSE player_a END AS id,
      count(*)::int AS lifetime,count(*) FILTER(WHERE played_on>=current_date-30)::int AS recent FROM state_matches
      WHERE status='confirmed' AND (player_a=$1 OR player_b=$1) GROUP BY 1`,[viewerId]);
    pool.history=Object.fromEntries(history.map(h=>[h.id,h]));
  }
  const sessions:SessionView[]=pool.sessions.flatMap(s=>{
    const member=s.members.find(m=>m.playerId===viewerId&&["accepted","pending"].includes(m.status));
    if(!member)return [];
    return [{id:s.id,startAt:s.startAt,endAt:s.endAt,venueId:s.venueId,minPlayers:s.minPlayers,targetSize:s.targetSize,maxPlayers:s.maxPlayers,
      status:Date.parse(s.endAt)<=now?"completed":s.status,acceptedPlayers:s.accepted.map(a=>a.player),myStatus:member.status,
      // An inviter can see that invitations await answers, but never declined/withdrawn members.
      pendingInvitees:member.status==="accepted"?s.members.filter(m=>m.status==="pending").flatMap(m=>{const p=pool.slots.find(a=>a.playerId===m.playerId)?.player;return p?[p]:[];}):[]}];
  });
  return {...base,mine,availability,sessions,opportunities:viewerId?marketplaceOpportunities(viewerId,{...pool,slots:liveSlots})
    .filter(o=>hkDate(new Date(o.startAt))===date).map(publicOpportunity):[]};
}

export type MarketAction = "publish"|"edit"|"activate"|"withdraw"|"create"|"join"|"leave"|"invite"|"accept"|"decline"|"avoid"|"unavoid"|"result";
export async function marketplaceWrite(database:MarketDatabase,actor:string,action:MarketAction,input:Record<string,unknown>,now=Date.now()) {
  const events:{event:string;props:Record<string,unknown>}[]=[];
  const result=await database.transaction(async db=>{
    await db.query(`SELECT pg_advisory_xact_lock(726341,2)`);
    await db.query(`SELECT set_config('app.marketplace_write','on',true)`);
    const [player]=await db.query<{id:string}>(`SELECT p.id FROM state_players p WHERE p.id=$1 AND p.active
      AND EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id AND m.active)`,[actor]);
    if(!player)fail("請先連結有效球員檔案。",403);
    let pool=await readPool(db,now);
    const id=typeof input.id==="string"?input.id:"";
    const slotId=typeof input.slotId==="string"?input.slotId:"";
    const target=typeof input.playerId==="string"?input.playerId:"";
    const eligible=(s:Supply)=>!s.cancelled&&Date.parse(s.endAt)>now;
    const ownSlot=(value:string)=>pool.slots.find(s=>s.id===value&&s.playerId===actor&&eligible(s))??fail("請先公開合適空檔。");
    const live=()=>pool.sessions.find(s=>s.id===id&&["forming","playable","full"].includes(s.status)&&Date.parse(s.endAt)>now)??fail("這個安排已結束或不存在。");
    const queue=async(s:LiveFormation,kind:string,players:string[],revision=s.revision)=>{
      for(const p of new Set(players))await db.query(`INSERT INTO matchmaking_delivery(id,session_id,player_id,kind,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[crypto.randomUUID(),s.id,p,kind,revision]);
    };
    const recruit=async(s:LiveFormation)=>{
      const fresh=await readPool(db,now);
      const candidates=fresh.slots.filter(a=>eligible(a)&&a.commitment==="going"&&canJoin(a,s,fresh)&&!s.members.some(m=>m.playerId===a.playerId))
        .sort((a,b)=>Math.abs(a.targetSize-s.targetSize)-Math.abs(b.targetSize-s.targetSize)||a.id.localeCompare(b.id));
      await queue(s,"recruit",[...new Set(candidates.map(a=>a.playerId))].slice(0,3));
    };
    const recalculate=async(sessionId:string)=>{
      const fresh=await readPool(db,now),s=fresh.sessions.find(s=>s.id===sessionId);
      if(!s)return;
      const status=marketplaceFormationStatus(s.accepted.length,s);
      if(status!==s.status){
        const reopening=["playable","full"].includes(s.status)&&status==="forming";
        await db.query(`UPDATE matchmaking_sessions SET status=$2,revision=revision+1,reopened=reopened OR $3,
          cancelled_at=CASE WHEN $2='cancelled' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,[s.id,status,reopening]);
        const updated={...s,status,revision:s.revision+1};
        events.push({event:reopening?"matchmaking_formation_reopened":`matchmaking_formation_${status}`,props:{sessionId:s.id,accepted_count:s.accepted.length,group_min:s.minPlayers,group_max:s.maxPlayers}});
        if(s.reopened&&s.status==="forming"&&["playable","full"].includes(status))events.push({event:"matchmaking_formation_salvaged",props:{sessionId:s.id}});
        if(reopening)await queue(updated,"reopened",s.accepted.map(a=>a.playerId));
        if(s.status==="forming"&&["playable","full"].includes(status))await queue(updated,"playable",s.accepted.map(a=>a.playerId));
        if(status==="forming")await recruit(updated);
      }
    };
    const add=async(s:LiveFormation,slot:Supply,status:"pending"|"accepted")=>{
      const current=s.members.find(m=>m.playerId===slot.playerId);
      if(current?.status===status||current?.status==="accepted")return;
      if(!canJoin(slot,s,pool))fail("這個安排已不適合，請選擇其他球友。");
      const accepted=[...s.accepted,slot];
      if(status==="accepted"&&accepted.length>=s.minPlayers){
        const inactive=await db.query(`SELECT p.id FROM state_players p WHERE p.id=ANY($1::text[]) AND (NOT p.active
          OR (EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id) AND NOT EXISTS(SELECT 1 FROM members m WHERE m.state_player_id=p.id AND m.active)))`,[accepted.map(a=>a.playerId)]);
        if(inactive.length)fail("有球員暫時未能參加，請重新整理安排。");
      }
      if(status==="accepted"&&accepted.length>=s.minPlayers&&accepted.some(a=>pool.conflicts.some(c=>c.sessionId!==s.id&&c.playerId===a.playerId&&overlaps(c,s))))fail("有球員在這段時間已有確認安排。");
      await db.query(`INSERT INTO matchmaking_session_members(session_id,player_id,availability_slot_id,role,status,eligibility,responded_at)
        VALUES($1,$2,$3,'member',$4,$5::jsonb,CASE WHEN $4='accepted' THEN now() ELSE NULL END)
        ON CONFLICT(session_id,player_id) DO UPDATE SET status=EXCLUDED.status,availability_slot_id=EXCLUDED.availability_slot_id,
          eligibility=EXCLUDED.eligibility,responded_at=EXCLUDED.responded_at,updated_at=now()`,[s.id,slot.playerId,slot.id,status,JSON.stringify(slot)]);
      if(status==="pending")await queue(s,"invite",[slot.playerId]);
      else {
        if(accepted.length>=s.minPlayers){
          const affected=await db.query<{id:string}>(`UPDATE matchmaking_session_members m SET status='withdrawn',updated_at=now()
            FROM matchmaking_sessions other WHERE m.session_id=other.id AND other.source<>'legacy' AND other.status='forming'
            AND other.id<>$1 AND other.start_at<$2 AND other.end_at>$3 AND m.player_id=ANY($4::text[]) AND m.status IN ('accepted','pending') RETURNING other.id`,[s.id,s.endAt,s.startAt,accepted.map(a=>a.playerId)]);
          for(const other of new Set(affected.map(a=>a.id)))await recalculate(other);
        }
        await recalculate(s.id);
      }
    };

    if(action==="publish"||action==="edit"){
      const interval=validateAvailabilityInterval({startAt:String(input.startAt??""),endAt:String(input.endAt??"")},now);
      const date=hkDate(new Date(interval.startAt));
      if(date<hkDate(new Date(now))||date>addDaysHongKong(hkDate(new Date(now)),6)||Date.parse(interval.endAt)-Date.parse(interval.startAt)<3600000)fail("請選擇未來七日內最少一小時的空檔。",400);
      const range=validateGroupRange({minPlayers:input.minPlayers as number,targetSize:input.targetSize as number,maxPlayers:input.maxPlayers as number});
      const venueId=typeof input.venueId==="string"&&input.venueId?input.venueId:null;
      const venueScope=parseVenueScope(input.venueScope,venueId),conditions=parseMatchConditions(input.conditions);
      if(venueId&&!pool.venues.some(v=>v.id===venueId))fail("請選擇有效波房。",400);
      if(venueScope==="district"&&!pool.venues.find(v=>v.id===venueId)?.district)fail("這間波房未設定地區。",400);
      if(input.commitment!=="going"&&input.commitment!=="interested")fail("請選擇約戰狀態。",400);
      const slot:Supply={id:action==="edit"?id:crypto.randomUUID(),playerId:actor,player:pool.slots.find(s=>s.playerId===actor)?.player??{id:actor,name:"",rating:0},...interval,...range,venueId,venueScope,conditions,commitment:input.commitment,source:"marketplace"};
      if(action==="edit"){
        if(ownSlot(id).source!=="marketplace")fail("請在原有空檔介面修改。",403);
        for(const s of pool.sessions.filter(s=>s.members.some(m=>m.playerId===actor&&m.availabilitySlotId===id&&m.status==="accepted"))){
          if(slot.minPlayers>s.minPlayers||slot.maxPlayers<s.maxPlayers||Date.parse(slot.startAt)>Date.parse(s.startAt)||Date.parse(slot.endAt)<Date.parse(s.endAt)||!acceptsVenue(slot,s.venueId,pool.venues)||JSON.stringify(conditions)!==JSON.stringify(ownSlot(id).conditions))fail("請先退出受影響的安排，再修改空檔。");
        }
        await db.query(`UPDATE availability_slots SET start_at=$3,end_at=$4,venue_id=$5,venue_scope=$6,min_players=$7,target_size=$8,max_players=$9,commitment=$10,conditions=$11::jsonb,updated_at=now() WHERE id=$1 AND player_id=$2`,[id,actor,slot.startAt,slot.endAt,venueId,venueScope,range.minPlayers,range.targetSize,range.maxPlayers,slot.commitment,JSON.stringify(conditions)]);
      }else{
        const duplicate=pool.slots.find(s=>s.playerId===actor&&eligible(s)&&s.source==="marketplace"&&s.startAt===slot.startAt&&s.endAt===slot.endAt&&s.venueId===slot.venueId&&s.venueScope===slot.venueScope&&s.minPlayers===slot.minPlayers&&s.maxPlayers===slot.maxPlayers&&s.targetSize===slot.targetSize&&s.commitment===slot.commitment&&JSON.stringify(s.conditions)===JSON.stringify(slot.conditions));
        if(duplicate)return {id:duplicate.id};
        await db.query(`INSERT INTO availability_slots(id,player_id,start_at,end_at,venue_id,venue_scope,min_players,target_size,max_players,commitment,conditions,source)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'marketplace')`,[slot.id,actor,slot.startAt,slot.endAt,venueId,venueScope,range.minPlayers,range.targetSize,range.maxPlayers,slot.commitment,JSON.stringify(conditions)]);
      }
      if(slot.commitment==="going")for(const s of pool.sessions.filter(s=>canJoin(slot,s,pool)).slice(0,3))await queue(s,"recruit",[actor]);
      return {id:slot.id};
    }
    if(action==="activate"||action==="withdraw"){
      const slot=ownSlot(id);if(slot.source!=="marketplace")fail("請在原有空檔介面修改。",403);
      await db.query(action==="activate"?`UPDATE availability_slots SET commitment='going',updated_at=now() WHERE id=$1`:`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id=$1`,[id]);
      if(action==="activate")for(const s of pool.sessions.filter(s=>canJoin(slot,s,pool)).slice(0,3))await queue(s,"recruit",[actor]);
      return {id};
    }
    if(action==="avoid"||action==="unavoid"){
      if(!target||target===actor)fail("請選擇另一位球員。",400);
      const [other]=await db.query(`SELECT id FROM state_players WHERE id=$1`,[target]);if(!other)fail("找不到球員。",404);
      if(action==="avoid")await db.query(`INSERT INTO matchmaking_pair_preferences(player_id,other_player_id,preference) VALUES($1,$2,'avoid') ON CONFLICT DO NOTHING`,[actor,target]);
      else await db.query(`DELETE FROM matchmaking_pair_preferences WHERE player_id=$1 AND other_player_id=$2`,[actor,target]);
      return {ok:true};
    }
    if(action==="result"){
      const session=pool.sessions.find(s=>s.id===id)??fail();
      if(Date.parse(session.startAt)>now||!session.members.some(m=>m.playerId===actor&&m.status==="accepted"))fail("你不在這個安排內。",403);
      const matchId=String(input.matchId??"");
      const [match]=await db.query<{a:string;b:string;playedOn:string}>(`SELECT player_a AS a,player_b AS b,played_on::text AS "playedOn" FROM state_matches WHERE id=$1 AND status='confirmed'`,[matchId]);
      if(!match||![match.a,match.b].includes(actor)||![match.a,match.b].every(p=>session.accepted.some(a=>a.playerId===p))||match.playedOn!==hkDate(new Date(session.startAt)))fail("賽果不屬於這個安排。",400);
      await db.query(`INSERT INTO matchmaking_results(match_id,session_id,player_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[matchId,id,actor]);
      return {id};
    }
    if(action==="leave"||action==="decline"){
      const [previous]=await db.query<{status:string}>(`SELECT m.status FROM matchmaking_session_members m JOIN matchmaking_sessions s ON s.id=m.session_id WHERE s.source<>'legacy' AND m.session_id=$1 AND m.player_id=$2`,[id,actor]);
      if(previous?.status===(action==="leave"?"withdrawn":"declined"))return {id};
      const s=live(),m=s.members.find(m=>m.playerId===actor);
      if(!m)fail("你不在這個安排內。",403);
      if(action==="decline"&&m.status!=="pending"){if(m.status==="declined")return {id};fail();}
      await db.query(`UPDATE matchmaking_session_members SET status=$3,responded_at=now(),updated_at=now() WHERE session_id=$1 AND player_id=$2`,[id,actor,action==="decline"?"declined":"withdrawn"]);
      await recalculate(id);return {id};
    }
    if(action==="join"||action==="accept"){
      const s=live();
      if(s.members.some(m=>m.playerId===actor&&m.status==="accepted"))return {id};
      if(action==="accept"&&!s.members.some(m=>m.playerId===actor&&m.status==="pending"))fail("找不到待回覆的邀請。",403);
      const slot=slotId?ownSlot(slotId):pool.slots.find(supply=>supply.playerId===actor&&eligible(supply)&&canJoin(supply,s,pool))??fail("請先公開涵蓋這個安排的空檔。");
      await add(s,slot,"accepted");return {id};
    }
    if(action==="invite"&&id){
      const s=live();if(!s.members.some(m=>m.playerId===actor&&m.status==="accepted"))fail("只有參加者可以邀請球友。",403);
      const slot=pool.slots.find(a=>a.id===slotId&&a.playerId===target&&eligible(a))??fail();
      await add(s,slot,"pending");return {id};
    }
    if(action!=="create"&&action!=="invite")fail("無效操作。",400);
    const mine=ownSlot(String(input.ownSlotId??slotId));
    let proposal:Opportunity;
    let invited:Supply|undefined;
    if(action==="invite"){
      invited=pool.slots.find(a=>a.id===slotId&&a.playerId===target&&eligible(a))??fail();
      const window=resolveGroup([mine,invited],pool);
      if(!window)fail("暫時未有合適的共同時段。");
      const minPlayers=Math.max(mine.minPlayers,invited.minPlayers),maxPlayers=Math.min(mine.maxPlayers,invited.maxPlayers);
      if(minPlayers>maxPlayers)fail("人數偏好不相容。");
      proposal={...window,minPlayers,maxPlayers,targetSize:Math.max(minPlayers,Math.min(maxPlayers,mine.targetSize)),slotId:mine.id,key:"direct",sessionId:null,acceptedPlayers:[],compatibleCount:1,score:0,hints:[]};
    }else proposal=marketplaceOpportunities(actor,{...pool,slots:pool.slots.filter(eligible)}).find(o=>o.key===input.key&&o.slotId===mine.id)??fail("建議已更新，請重新選擇。");
    const reusable=pool.sessions.find(s=>s.venueId===proposal.venueId&&s.startAt===proposal.startAt&&s.endAt===proposal.endAt&&s.minPlayers===proposal.minPlayers&&s.maxPlayers===proposal.maxPlayers
      &&(s.members.some(m=>m.playerId===actor&&m.status==="accepted")||canJoin(mine,s,pool))&&(!invited||canJoin(invited,s,pool)||s.members.some(m=>m.playerId===invited!.playerId&&["pending","accepted"].includes(m.status))));
    let session=reusable;
    if(!session){
      if(pool.conflicts.some(c=>c.playerId===actor&&overlaps(c,proposal)))fail("這段時間已有確認安排。");
      session={...proposal,id:crypto.randomUUID(),createdByPlayerId:actor,source:invited?"direct":"marketplace",status:"forming",members:[],accepted:[],revision:0};
      await db.query(`INSERT INTO matchmaking_sessions(id,host_player_id,anchor_slot_id,created_by_player_id,start_at,end_at,venue_id,min_players,target_size,max_players,source)
        VALUES($1,NULL,NULL,$2,$3,$4,$5,$6,$7,$8,$9)`,[session.id,actor,session.startAt,session.endAt,session.venueId,session.minPlayers,session.targetSize,session.maxPlayers,session.source]);
    }
    await add(session,mine,"accepted");
    pool=await readPool(db,now);session=pool.sessions.find(s=>s.id===session!.id)!;
    if(invited)await add(session,invited,"pending");
    await recruit(session);
    return {id:session.id};
  });
  return {...result,events};
}
