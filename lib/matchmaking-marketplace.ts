import type {Interval} from "./availability.ts";
import type {FormationStatus} from "./matchmaking-formation.ts";

/** Marketplace contracts are separate from legacy SlotConditions / host-owned sessions. */
export type MatchConditions = {
  handicap?: boolean;
  noSmoking?: boolean;
  levelPreference?: "similar" | "any";
  levelStrict?: boolean;
  feePreference?: "aa" | "any";
  tempo?: "sport" | "casual" | "any";
};
export type VenueScope = "exact" | "district" | "any_hk";
export type AvailabilityCommitment = "going" | "interested";
export type FormationSource = "marketplace" | "direct" | "legacy";
export type FormationMemberStatus = "pending" | "accepted" | "declined" | "withdrawn";
export type GroupRange = {minPlayers: number; targetSize: number; maxPlayers: number};

export const GROUP_PRESETS = {
  singles: {minPlayers: 2, targetSize: 2, maxPlayers: 2},
  small: {minPlayers: 2, targetSize: 3, maxPlayers: 3},
  rotation: {minPlayers: 4, targetSize: 5, maxPlayers: 6},
  flexible: {minPlayers: 2, targetSize: 4, maxPlayers: 6},
} as const satisfies Record<string, GroupRange>;

export type MatchableAvailability = Interval & GroupRange & {
  id: string;
  playerId: string;
  venueId: string | null;
  venueScope: VenueScope;
  commitment: AvailabilityCommitment;
  conditions: MatchConditions;
  source?: "legacy" | "marketplace";
};

export type FormationMember = {
  playerId: string;
  availabilitySlotId: string | null;
  status: FormationMemberStatus;
};

export type MarketplaceSession = Interval & GroupRange & {
  id: string;
  createdByPlayerId: string | null;
  source: Exclude<FormationSource, "legacy">;
  venueId: string | null;
  status: FormationStatus;
  members: FormationMember[];
};

/** Server-only input: never include this relationship in a public dashboard DTO. */
export type MatchmakingPairPreference = {
  playerId: string;
  otherPlayerId: string;
  preference: "avoid";
};

export function validateGroupRange(range: GroupRange): GroupRange {
  const {minPlayers, targetSize, maxPlayers} = range;
  if (![minPlayers, targetSize, maxPlayers].every(Number.isInteger)
    || minPlayers < 2 || minPlayers > targetSize || targetSize > maxPlayers || maxPlayers > 6) {
    throw new Error("人數必須符合 2 ≤ 最少 ≤ 理想 ≤ 最多 ≤ 6。");
  }
  return {minPlayers, targetSize, maxPlayers};
}

export type MarketplacePlayer = {id:string; name:string; rating:number};
export type MarketplaceVenue = {id:string; name:string; district:string};
export type MarketplaceDeliveryKind="invite"|"playable"|"reopened"|"recruit"|"reminder"|"result";

/** Reject delayed jobs whose meaning expired while they waited in the durable queue. */
export function marketplaceDeliveryTimingValid(kind:MarketplaceDeliveryKind,session:Interval,now=Date.now()) {
  const start=Date.parse(session.startAt),end=Date.parse(session.endAt);
  if(!Number.isFinite(start)||!Number.isFinite(end))return false;
  if(kind==="reminder")return start>now&&start<=now+3600000;
  if(kind==="result")return end<=now&&end>now-86400000;
  return end>now;
}
export type Supply = MatchableAvailability & {player:MarketplacePlayer; cancelled?:boolean};
export type LiveFormation = MarketplaceSession & {accepted:Supply[]; revision:number; reopened?:boolean};
export type Conflict = Interval & {playerId:string; sessionId:string};
export type MarketPool = {slots:Supply[]; venues:MarketplaceVenue[]; sessions:LiveFormation[]; conflicts:Conflict[]; avoids:MatchmakingPairPreference[]; history?:Record<string,{recent:number;lifetime:number}>};
export type Opportunity = Interval & GroupRange & {
  key:string; sessionId:string|null; slotId:string; venueId:string|null;
  acceptedPlayers:MarketplacePlayer[]; compatibleCount:number; score:number; hints:string[];
};
export type SessionView = Interval & GroupRange & {
  id:string; venueId:string|null; status:FormationStatus; acceptedPlayers:MarketplacePlayer[];
  myStatus:FormationMemberStatus; pendingInvitees:MarketplacePlayer[];
};
export type MarketplaceDashboard = {
  ready:boolean; signedIn:boolean; viewerId:string|null; date:string;
  dates:{date:string;publicPlayers:number;activePlayers:number;formingGroups:number}[];
  venues:MarketplaceVenue[]; availability:Supply[]; mine:Supply[];
  opportunities:Opportunity[]; sessions:SessionView[];
};

export const overlaps = (a:Interval,b:Interval) => Date.parse(a.startAt)<Date.parse(b.endAt)&&Date.parse(b.startAt)<Date.parse(a.endAt);
export const avoidsPair = (pool:MarketPool,a:string,b:string) => pool.avoids.some(p=>p.playerId===a&&p.otherPlayerId===b||p.playerId===b&&p.otherPlayerId===a);

export function acceptsVenue(slot:MatchableAvailability,venueId:string|null,venues:MarketplaceVenue[]) {
  if(slot.venueScope==="any_hk")return true;
  if(!venueId||!slot.venueId)return false;
  if(slot.venueScope==="exact")return slot.venueId===venueId;
  const district=venues.find(v=>v.id===slot.venueId)?.district;
  return Boolean(district&&venues.find(v=>v.id===venueId)?.district===district);
}

export function pairCompatible(a:Supply,b:Supply,pool:MarketPool) {
  if(a.playerId===b.playerId||avoidsPair(pool,a.playerId,b.playerId))return false;
  const difference=Math.abs(a.player.rating-b.player.rating);
  if((a.conditions.levelStrict||b.conditions.levelStrict)&&difference>100)return false;
  if(difference>200&&(a.conditions.levelPreference!=="any"||b.conditions.levelPreference!=="any")&&!(a.conditions.handicap&&b.conditions.handicap))return false;
  return true;
}

export function resolveGroup(slots:Supply[],pool:MarketPool): (Interval & {venueId:string|null})|null {
  if(!slots.length||new Set(slots.map(s=>s.playerId)).size!==slots.length)return null;
  for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++)if(!pairCompatible(slots[i],slots[j],pool))return null;
  const start=Math.max(...slots.map(s=>Date.parse(s.startAt))),end=Math.min(...slots.map(s=>Date.parse(s.endAt)));
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<3600000)return null;
  const ranked=[...pool.venues].sort((a,b)=>{
    const fit=(id:string)=>slots.reduce((sum,s)=>sum+(s.venueId===id?(s.venueScope==="exact"?100:10):0),0);
    return fit(b.id)-fit(a.id)||a.id.localeCompare(b.id);
  });
  const venue=ranked.find(v=>slots.every(s=>acceptsVenue(s,v.id,pool.venues)));
  // If everyone has no venue preference, keep the decision open instead of inventing a booking.
  const venueId=slots.every(s=>!s.venueId&&s.venueScope==="any_hk")?null:venue?.id;
  if(venueId===undefined)return null;
  return {startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString(),venueId};
}

export function canJoin(slot:Supply,session:LiveFormation,pool:MarketPool) {
  if(!["forming","playable"].includes(session.status)||session.accepted.length>=session.maxPlayers)return false;
  if(slot.minPlayers>session.minPlayers||slot.maxPlayers<session.maxPlayers)return false;
  if(Date.parse(slot.startAt)>Date.parse(session.startAt)||Date.parse(slot.endAt)<Date.parse(session.endAt))return false;
  if(!acceptsVenue(slot,session.venueId,pool.venues))return false;
  if(session.accepted.some(p=>!pairCompatible(slot,p,pool)))return false;
  return !pool.conflicts.some(c=>c.playerId===slot.playerId&&c.sessionId!==session.id&&overlaps(c,session));
}

function scoreGroup(slots:Supply[],viewer:string,window:Interval,size:number,pool:MarketPool) {
  const mine=slots.find(s=>s.playerId===viewer)!;
  const others=slots.filter(s=>s.playerId!==viewer);
  const average=(fn:(s:Supply)=>number)=>others.reduce((sum,s)=>sum+fn(s),0)/Math.max(1,others.length);
  return average(s=>s.commitment==="going"?100:0)+Math.min((Date.parse(window.endAt)-Date.parse(window.startAt))/3600000,4)*20
    +average(s=>Math.max(0,30-Math.abs(s.targetSize-size)*10))
    +average(s=>s.venueId===mine.venueId?20:0)
    +average(s=>Math.max(0,30-Math.abs(s.player.rating-mine.player.rating)/10))
    +average(s=>{const h=pool.history?.[s.playerId];return h?Math.max(-15,5-h.recent*3):10;});
}

/** Bounded greedy candidates, re-created by the server on every write. Potential members stay private. */
export function marketplaceOpportunities(viewer:string,pool:MarketPool):Opportunity[] {
  const result:Opportunity[]=[];
  const own=pool.slots.filter(s=>s.playerId===viewer&&!s.cancelled);
  for(const mine of own){
    for(const session of pool.sessions){
      if(!canJoin(mine,session,pool))continue;
      const {startAt,endAt,venueId,minPlayers,targetSize,maxPlayers}=session;
      result.push({startAt,endAt,venueId,minPlayers,targetSize,maxPlayers,key:`session:${session.id}:${mine.id}`,sessionId:session.id,slotId:mine.id,
        acceptedPlayers:session.accepted.map(s=>s.player),compatibleCount:session.accepted.length,
        score:10000+session.accepted.length*100+scoreGroup([mine,...session.accepted],viewer,session,session.targetSize,pool),
        hints:["時間及場地合適",session.accepted.length+1>=session.minPlayers?"你加入後可以成局":"正在招募球友"]});
    }
    for(const size of [2,3,4,5,6]){
      if(mine.minPlayers>size||mine.maxPlayers<size)continue;
      const candidates=pool.slots.filter(s=>!s.cancelled&&s.minPlayers<=size&&s.maxPlayers>=size&&pairCompatible(mine,s,pool))
        .sort((a,b)=>scoreGroup([mine,b],viewer,mine,size,pool)-scoreGroup([mine,a],viewer,mine,size,pool)||a.id.localeCompare(b.id));
      for(const seed of candidates.slice(0,8)){
        const group=[mine,seed];
        for(const next of candidates){
          if(group.length>=size)break;
          if(!group.some(s=>s.playerId===next.playerId)&&resolveGroup([...group,next],pool))group.push(next);
        }
        if(group.length!==size)continue;
        const window=resolveGroup(group,pool);
        if(!window||group.some(s=>pool.conflicts.some(c=>c.playerId===s.playerId&&overlaps(c,window))))continue;
        const minPlayers=Math.max(...group.map(s=>s.minPlayers));
        const maxPlayers=Math.min(...group.map(s=>s.maxPlayers));
        const difference=Math.max(...group.map(s=>Math.abs(s.player.rating-mine.player.rating)));
        const key=`candidate:${group.map(s=>s.id).sort().join(":")}:${size}`;
        result.push({...window,minPlayers,targetSize:size,maxPlayers,key,sessionId:null,slotId:mine.id,
          acceptedPlayers:[],compatibleCount:size-1,score:scoreGroup(group,viewer,window,size,pool),
          hints:["球友尚未加入",difference<=100?"水平相近":difference<=200?"擴闊水平範圍":group.every(s=>s.conditions.handicap)?"水平有差距 · 可按 ELO 建議讓分":"水平有差距"]});
      }
    }
  }
  const sorted=result.sort((a,b)=>b.score-a.score||a.startAt.localeCompare(b.startAt)||a.key.localeCompare(b.key));
  const seen=new Set<string>();
  return sorted.filter(o=>{
    if(!o.sessionId&&pool.sessions.some(s=>s.members.some(m=>m.playerId===viewer&&m.status==="accepted")&&s.startAt===o.startAt&&s.endAt===o.endAt&&s.venueId===o.venueId&&s.minPlayers===o.minPlayers&&s.maxPlayers===o.maxPlayers))return false;
    const k=o.sessionId??[o.slotId,o.startAt,o.endAt,o.venueId,o.minPlayers,o.targetSize,o.maxPlayers].join("|");
    if(seen.has(k))return false;seen.add(k);return true;
  }).slice(0,24);
}

/** Missing scope follows the old meaning: a selected venue is exact, no venue is flexible. */
export function parseVenueScope(value: unknown, venueId: string | null): VenueScope {
  const scope = value === undefined ? (venueId ? "exact" : "any_hk") : value;
  if (scope !== "exact" && scope !== "district" && scope !== "any_hk") {
    throw new Error("請選擇有效的場地彈性。");
  }
  if (scope !== "any_hk" && !venueId) throw new Error("指定場地或地區需要先選擇波房。");
  return scope;
}

/** Strict parsing for new writes. Historical OpenBoard costSplit/levelOnly are not reinterpreted. */
export function parseMatchConditions(value: unknown): MatchConditions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("約戰條件格式不正確。");
  const raw = value as Record<string, unknown>;
  const result: MatchConditions = {};
  for (const key of ["handicap", "noSmoking", "levelStrict"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") throw new Error(`Invalid ${key}`);
    result[key] = raw[key];
  }
  if (raw.levelPreference !== undefined) {
    if (raw.levelPreference !== "similar" && raw.levelPreference !== "any") throw new Error("Invalid levelPreference");
    result.levelPreference = raw.levelPreference;
  }
  if (raw.feePreference !== undefined) {
    if (raw.feePreference !== "aa" && raw.feePreference !== "any") throw new Error("Invalid feePreference");
    result.feePreference = raw.feePreference;
  }
  if (raw.tempo !== undefined) {
    if (raw.tempo !== "sport" && raw.tempo !== "casual" && raw.tempo !== "any") throw new Error("Invalid tempo");
    result.tempo = raw.tempo;
  }
  if (result.levelStrict && result.levelPreference === "any") throw new Error("不限水平不能同時設為嚴格水平限制。");
  return result;
}

/** Call after consent changes on live sessions only; never reopen completed/cancelled sessions. */
export function marketplaceFormationStatus(accepted: number, range: GroupRange): FormationStatus {
  validateGroupRange(range);
  if (!Number.isInteger(accepted) || accepted < 0 || accepted > range.maxPlayers) {
    throw new Error("Invalid accepted member count");
  }
  if (accepted === 0) return "cancelled";
  if (accepted < range.minPlayers) return "forming";
  return accepted < range.maxPlayers ? "playable" : "full";
}
