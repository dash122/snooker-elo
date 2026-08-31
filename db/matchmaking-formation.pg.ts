import {getSql} from "./sql";
import {bestCommonWindow, formationStatus, opportunityScore, venuesCompatible, viableOverlap, type CommonWindow, type FormationSlot, type FormationStatus} from "../lib/matchmaking-formation";
import {hkDate, overlapMinutes, type SlotConditions} from "../lib/availability";

type SlotRow = {
  id:string; playerId:string; startAt:Date|string; endAt:Date|string; targetSize:number;
  venueId:string|null; venueName:string|null; name:string; short:string; rating:number|string;
  colour:string|null; avatar:string|null;
};

type HistoryRow = {opponentId:string; lifetime:number|string; recent:number|string};
type VenueRow = {id:string;name:string;district:string};
type SessionRow = {
  id:string;hostPlayerId:string;anchorSlotId:string;startAt:Date|string;endAt:Date|string;
  venueId:string|null;venueName:string|null;targetSize:number;status:FormationStatus;
};
type SessionMemberRow = {
  sessionId:string;playerId:string;role:"host"|"member";status:"pending"|"accepted"|"declined"|"withdrawn";
  requestedAt:Date|string;name:string;short:string;rating:number|string;avatar:string|null;colour:string|null;
};
type AnchorSessionRow = {anchorSlotId:string;startAt:Date|string;endAt:Date|string;status:FormationStatus};

const iso=(value:Date|string)=>new Date(value).toISOString();

export type FormationOpportunity = {
  anchorSlotId:string;
  player:{id:string;name:string;short:string;rating:number;colour:string|null;avatar:string|null};
  startAt:string;endAt:string;proposedStartAt:string;proposedEndAt:string;
  targetSize:number;venue:{id:string;name:string}|null;
  overlapMinutes:number;compatiblePlayers:number;eloDifference:number;newOpponent:boolean;score:number;
};

export type FormationAvailability = {
  id:string;playerId:string;startAt:string;endAt:string;targetSize:number;
  venue:{id:string;name:string}|null;
};

export type FormationSession = {
  id:string;hostPlayerId:string;anchorSlotId:string;startAt:string;endAt:string;
  targetSize:number;status:FormationStatus;venue:{id:string;name:string}|null;
  acceptedCount:number;isHost:boolean;myStatus:string|null;
  acceptedPlayers:SessionMemberRowView[];pendingRequests:SessionMemberRowView[];
};

type SessionMemberRowView = {id:string;name:string;short:string;rating:number;avatar:string|null;colour:string|null};

function slotView(row:SlotRow):FormationAvailability {
  return {id:row.id,playerId:row.playerId,startAt:iso(row.startAt),endAt:iso(row.endAt),targetSize:Number(row.targetSize),venue:row.venueId?{id:row.venueId,name:row.venueName??""}:null};
}

async function activeSlots():Promise<SlotRow[]> {
  const sql=getSql();
  return sql<SlotRow[]>`SELECT s.id,s.player_id AS "playerId",s.start_at AS "startAt",s.end_at AS "endAt",
      s.target_size AS "targetSize",s.venue_id AS "venueId",v.name AS "venueName",
      p.name,p.short,p.rating::float8 AS rating,p.colour,p.avatar
    FROM availability_slots s
    JOIN state_players p ON p.id=s.player_id AND p.active=true
    LEFT JOIN venues v ON v.id=s.venue_id
    WHERE s.cancelled_at IS NULL AND s.commitment='going' AND s.end_at>now()
      AND s.start_at<now()+interval '7 days'
    ORDER BY s.start_at,p.name`;
}

async function playerHistory(playerId:string):Promise<Map<string,{lifetime:number;recent:number}>> {
  const sql=getSql();
  const rows=await sql<HistoryRow[]>`SELECT CASE WHEN player_a=${playerId} THEN player_b ELSE player_a END AS "opponentId",
      count(*)::int AS lifetime,
      count(*) FILTER (WHERE played_on>=current_date-30)::int AS recent
    FROM state_matches
    WHERE status='confirmed' AND (player_a=${playerId} OR player_b=${playerId})
    GROUP BY 1`;
  return new Map(rows.map(row=>[row.opponentId,{lifetime:Number(row.lifetime),recent:Number(row.recent)}]));
}

async function listSessions(playerId:string):Promise<FormationSession[]> {
  const sql=getSql();
  const sessions=await sql<SessionRow[]>`SELECT DISTINCT s.id,s.host_player_id AS "hostPlayerId",s.anchor_slot_id AS "anchorSlotId",
      s.start_at AS "startAt",s.end_at AS "endAt",s.venue_id AS "venueId",v.name AS "venueName",
      s.target_size AS "targetSize",s.status
    FROM matchmaking_sessions s
    LEFT JOIN venues v ON v.id=s.venue_id
    LEFT JOIN matchmaking_session_members mine ON mine.session_id=s.id AND mine.player_id=${playerId}
    WHERE s.cancelled_at IS NULL AND s.end_at>now()-interval '6 hours'
      AND (s.host_player_id=${playerId} OR mine.player_id IS NOT NULL)
    ORDER BY s.start_at`;
  if(!sessions.length)return [];
  const members=await sql<SessionMemberRow[]>`SELECT m.session_id AS "sessionId",m.player_id AS "playerId",m.role,m.status,
      m.requested_at AS "requestedAt",p.name,p.short,p.rating::float8 AS rating,p.avatar,p.colour
    FROM matchmaking_session_members m JOIN state_players p ON p.id=m.player_id
    WHERE m.session_id IN ${sql(sessions.map(item=>item.id))}
    ORDER BY m.requested_at`;
  const view=(member:SessionMemberRow):SessionMemberRowView=>({id:member.playerId,name:member.name,short:member.short,rating:Number(member.rating),avatar:member.avatar,colour:member.colour});
  return sessions.map(session=>{
    const all=members.filter(member=>member.sessionId===session.id);
    const mine=all.find(member=>member.playerId===playerId);
    const accepted=all.filter(member=>member.status==="accepted");
    const isHost=session.hostPlayerId===playerId;
    return {id:session.id,hostPlayerId:session.hostPlayerId,anchorSlotId:session.anchorSlotId,
      startAt:iso(session.startAt),endAt:iso(session.endAt),targetSize:Number(session.targetSize),status:session.status,
      venue:session.venueId?{id:session.venueId,name:session.venueName??""}:null,
      acceptedCount:accepted.length,isHost,myStatus:mine?.status??null,
      acceptedPlayers:accepted.map(view),pendingRequests:isHost?all.filter(member=>member.status==="pending").map(view):[]};
  });
}

export async function formationDashboard(playerId?:string|null) {
  const sql=getSql();
  const [rows,venues,anchorSessions]=await Promise.all([
    activeSlots(),
    sql<VenueRow[]>`SELECT id,name,district FROM venues WHERE active=true ORDER BY name`,
    sql<AnchorSessionRow[]>`SELECT anchor_slot_id AS "anchorSlotId",start_at AS "startAt",end_at AS "endAt",status
      FROM matchmaking_sessions WHERE status IN ('forming','playable','full') AND end_at>now()`,
  ]);
  const publicDays:Record<string,number>={};
  for(const row of rows){
    const date=hkDate(new Date(row.startAt));
    publicDays[date]=(publicDays[date]??0)+1;
  }
  if(!playerId)return {signedIn:false,own:[],opportunities:[],sessions:[],venues,publicDays};
  const ownRows=rows.filter(row=>row.playerId===playerId);
  const own=ownRows.map(slotView);
  const myRating=Number(ownRows[0]?.rating??(await sql<{rating:number|string}[]>`SELECT rating::float8 AS rating FROM state_players WHERE id=${playerId}`)[0]?.rating??0);
  const [history,mySessions]=await Promise.all([playerHistory(playerId),listSessions(playerId)]);
  const joinedAnchors=new Set(mySessions.filter(item=>item.myStatus==="pending"||item.myStatus==="accepted").map(item=>item.anchorSlotId));
  const sessionByAnchor=new Map(anchorSessions.map(item=>[item.anchorSlotId,item]));
  const formationSlots:FormationSlot[]=rows.map(row=>({id:row.id,playerId:row.playerId,startAt:iso(row.startAt),endAt:iso(row.endAt),venueId:row.venueId}));
  const ownIntervals=own.map(item=>({startAt:item.startAt,endAt:item.endAt,venueId:item.venue?.id??null}));
  const opportunities:FormationOpportunity[]=[];
  for(const row of rows){
    if(row.playerId===playerId||joinedAnchors.has(row.id))continue;
    const anchor:FormationSlot={id:row.id,playerId:row.playerId,startAt:iso(row.startAt),endAt:iso(row.endAt),venueId:row.venueId};
    const matchingMine=ownIntervals.filter(item=>venuesCompatible(item.venueId,anchor.venueId));
    const overlaps=viableOverlap(matchingMine,[anchor]);
    if(!overlaps.length)continue;
    const active=sessionByAnchor.get(row.id);
    if(active?.status==="full")continue;
    const common:CommonWindow|null=active?{
      startAt:iso(active.startAt),endAt:iso(active.endAt),
      playerIds:[...new Set(formationSlots.filter(slot=>venuesCompatible(anchor.venueId,slot.venueId)&&Date.parse(slot.startAt)<=Date.parse(iso(active.startAt))&&Date.parse(slot.endAt)>=Date.parse(iso(active.endAt))).map(slot=>slot.playerId))].sort(),
    }:bestCommonWindow(anchor,playerId,formationSlots);
    if(!common)continue;
    if(!common.playerIds.includes(playerId))continue;
    const minutes=overlapMinutes(overlaps),record=history.get(row.playerId)??{lifetime:0,recent:0};
    const difference=Math.abs(myRating-Number(row.rating));
    opportunities.push({anchorSlotId:row.id,player:{id:row.playerId,name:row.name,short:row.short,rating:Number(row.rating),colour:row.colour,avatar:row.avatar},
      startAt:anchor.startAt,endAt:anchor.endAt,proposedStartAt:common.startAt,proposedEndAt:common.endAt,
      targetSize:Number(row.targetSize),venue:row.venueId?{id:row.venueId,name:row.venueName??""}:null,
      overlapMinutes:minutes,compatiblePlayers:common.playerIds.length,eloDifference:difference,newOpponent:record.lifetime===0,
      score:opportunityScore({compatiblePlayers:common.playerIds.length,overlapMinutes:minutes,eloDifference:difference,recentMatches:record.recent})});
  }
  opportunities.sort((a,b)=>b.score-a.score||b.compatiblePlayers-a.compatiblePlayers||a.startAt.localeCompare(b.startAt));
  return {signedIn:true,own,opportunities:opportunities.slice(0,16),sessions:mySessions,venues,publicDays};
}

export async function publishFormationAvailability(playerId:string,items:{startAt:string;endAt:string;targetSize:number;venueId:string|null;conditions?:SlotConditions}[]) {
  const sql=getSql();
  return sql.begin(async tx=>{
    for(const item of items){
      const clashes=await tx<{id:string}[]>`SELECT id FROM availability_slots
        WHERE player_id=${playerId} AND cancelled_at IS NULL AND start_at<${item.endAt} AND end_at>${item.startAt}
        FOR UPDATE`;
      if(clashes.length){
        const ids=clashes.map(row=>row.id);
        await tx`UPDATE availability_slots SET cancelled_at=now(),updated_at=now() WHERE id IN ${tx(ids)}`;
        await tx`UPDATE matchmaking_sessions SET status='cancelled',cancelled_at=now(),updated_at=now()
          WHERE anchor_slot_id IN ${tx(ids)} AND status IN ('forming','playable','full')`;
      }
      await tx`INSERT INTO availability_slots
        (id,player_id,start_at,end_at,conditions,venue_id,commitment,target_size)
        VALUES (${crypto.randomUUID()},${playerId},${item.startAt},${item.endAt},${JSON.stringify(item.conditions??{})},${item.venueId},'going',${item.targetSize})`;
    }
  });
}

export async function cancelFormationAvailability(playerId:string,slotId:string) {
  const sql=getSql();
  return sql.begin(async tx=>{
    const rows=await tx<{id:string}[]>`UPDATE availability_slots SET cancelled_at=now(),updated_at=now()
      WHERE id=${slotId} AND player_id=${playerId} AND cancelled_at IS NULL AND end_at>now() RETURNING id`;
    if(!rows.length)return false;
    await tx`UPDATE matchmaking_sessions SET status='cancelled',cancelled_at=now(),updated_at=now()
      WHERE anchor_slot_id=${slotId} AND status IN ('forming','playable','full')`;
    return true;
  });
}

export async function requestFormationSession(playerId:string,input:{anchorSlotId:string;startAt:string;endAt:string}) {
  const sql=getSql();
  return sql.begin(async tx=>{
    const [anchor]=await tx<{id:string;playerId:string;startAt:Date|string;endAt:Date|string;venueId:string|null;targetSize:number}[]>`
      SELECT id,player_id AS "playerId",start_at AS "startAt",end_at AS "endAt",venue_id AS "venueId",target_size AS "targetSize"
      FROM availability_slots WHERE id=${input.anchorSlotId} AND cancelled_at IS NULL AND end_at>now() FOR UPDATE`;
    if(!anchor)throw new Error("這個空檔已經關閉。");
    if(anchor.playerId===playerId)throw new Error("不需要加入自己的空檔。");
    let [session]=await tx<{id:string;status:FormationStatus;targetSize:number;startAt:Date|string;endAt:Date|string}[]>`SELECT id,status,target_size AS "targetSize",start_at AS "startAt",end_at AS "endAt"
      FROM matchmaking_sessions WHERE anchor_slot_id=${anchor.id} AND status IN ('forming','playable','full') FOR UPDATE`;
    /* The first request chooses the exact hour. Later requests must join that same session window,
       not create parallel interpretations of the publisher's broad availability. */
    const chosenStart=session?iso(session.startAt):input.startAt,chosenEnd=session?iso(session.endAt):input.endAt;
    const start=Date.parse(chosenStart),end=Date.parse(chosenEnd);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<60*60_000)throw new Error("共同時段最少需要一小時。");
    if(start<Date.parse(String(anchor.startAt))||end>Date.parse(String(anchor.endAt)))throw new Error("建議時間已不在對方的空檔內。");
    const [mine]=await tx<{id:string}[]>`SELECT id FROM availability_slots
      WHERE player_id=${playerId} AND cancelled_at IS NULL AND commitment='going'
        AND start_at<=${chosenStart} AND end_at>=${chosenEnd}
        AND (venue_id IS NULL OR ${anchor.venueId}::text IS NULL OR venue_id=${anchor.venueId})
      ORDER BY start_at LIMIT 1 FOR UPDATE`;
    if(!mine)throw new Error("你的空檔與這個場次的確實時間不再重疊。");
    if(!session){
      const id=crypto.randomUUID();
      [session]=await tx<{id:string;status:FormationStatus;targetSize:number;startAt:Date|string;endAt:Date|string}[]>`INSERT INTO matchmaking_sessions
        (id,host_player_id,anchor_slot_id,start_at,end_at,venue_id,target_size,status)
        VALUES (${id},${anchor.playerId},${anchor.id},${chosenStart},${chosenEnd},${anchor.venueId},${anchor.targetSize},'forming')
        RETURNING id,status,target_size AS "targetSize",start_at AS "startAt",end_at AS "endAt"`;
      await tx`INSERT INTO matchmaking_session_members (session_id,player_id,availability_slot_id,role,status)
        VALUES (${id},${anchor.playerId},${anchor.id},'host','accepted')`;
    }
    if(session.status==="full")throw new Error("這個場次已經滿員。");
    await tx`INSERT INTO matchmaking_session_members (session_id,player_id,availability_slot_id,role,status,requested_at,updated_at)
      VALUES (${session.id},${playerId},${mine.id},'member','pending',now(),now())
      ON CONFLICT (session_id,player_id) DO UPDATE SET
        availability_slot_id=EXCLUDED.availability_slot_id,status=CASE
          WHEN matchmaking_session_members.status='accepted' THEN 'accepted' ELSE 'pending' END,
        requested_at=CASE WHEN matchmaking_session_members.status='accepted' THEN matchmaking_session_members.requested_at ELSE now() END,
        responded_at=NULL,updated_at=now()`;
    return session.id;
  });
}

export async function respondFormationRequest(hostPlayerId:string,sessionId:string,requesterId:string,action:"accept"|"decline") {
  const sql=getSql();
  return sql.begin(async tx=>{
    const [session]=await tx<{targetSize:number;status:FormationStatus}[]>`SELECT target_size AS "targetSize",status
      FROM matchmaking_sessions WHERE id=${sessionId} AND host_player_id=${hostPlayerId} AND status IN ('forming','playable','full') FOR UPDATE`;
    if(!session)throw new Error("找不到可處理的場次。");
    const [request]=await tx<{status:string}[]>`SELECT status FROM matchmaking_session_members
      WHERE session_id=${sessionId} AND player_id=${requesterId} AND role='member' FOR UPDATE`;
    if(!request||request.status!=="pending")throw new Error("這個申請已經處理。");
    const [{count}]=await tx<{count:number|string}[]>`SELECT count(*)::int AS count FROM matchmaking_session_members
      WHERE session_id=${sessionId} AND status='accepted'`;
    if(action==="accept"&&Number(count)>=Number(session.targetSize))throw new Error("這個場次已經滿員。");
    await tx`UPDATE matchmaking_session_members SET status=${action==="accept"?"accepted":"declined"},responded_at=now(),updated_at=now()
      WHERE session_id=${sessionId} AND player_id=${requesterId}`;
    const accepted=Number(count)+(action==="accept"?1:0),status=formationStatus(accepted,Number(session.targetSize));
    await tx`UPDATE matchmaking_sessions SET status=${status},updated_at=now() WHERE id=${sessionId}`;
    return status;
  });
}

export async function leaveFormationSession(playerId:string,sessionId:string) {
  const sql=getSql();
  return sql.begin(async tx=>{
    const [session]=await tx<{hostPlayerId:string;targetSize:number}[]>`SELECT host_player_id AS "hostPlayerId",target_size AS "targetSize"
      FROM matchmaking_sessions WHERE id=${sessionId} AND status IN ('forming','playable','full') FOR UPDATE`;
    if(!session)return false;
    if(session.hostPlayerId===playerId){
      await tx`UPDATE matchmaking_sessions SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE id=${sessionId}`;
      return true;
    }
    const changed=await tx<{playerId:string}[]>`UPDATE matchmaking_session_members SET status='withdrawn',updated_at=now()
      WHERE session_id=${sessionId} AND player_id=${playerId} AND status IN ('pending','accepted') RETURNING player_id AS "playerId"`;
    if(!changed.length)return false;
    const [{count}]=await tx<{count:number|string}[]>`SELECT count(*)::int AS count FROM matchmaking_session_members
      WHERE session_id=${sessionId} AND status='accepted'`;
    await tx`UPDATE matchmaking_sessions SET status=${formationStatus(Number(count),Number(session.targetSize))},updated_at=now() WHERE id=${sessionId}`;
    return true;
  });
}
