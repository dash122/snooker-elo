"use client";
import "../lib/legacy-storage";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { DEFAULT_AVATAR,PlayerBadge,PlayerForm } from "./UiBits";
import PlayBoard from "./play/PlayBoard";
import GuestIntro from "./GuestIntro";
import { FirstStepsChecklist,IntroTour } from "./FirstSteps";
import { usePlayBadge } from "./play/usePlay";
import { SquadAddedNotices,SquadCenter,SquadScopeMenu,usePublicSquad,useSquadViewTracking,useSquads,useUrlParam,writeUrlParam,type SquadSheet } from "./Squads";
import { isEntertainmentMode } from "../lib/entertainment-match";
import { shareSheetTitle } from "./ShareSheet";
import { HANDICAP_ELO_PER_POINT,HANDICAP_MODEL_VERSION } from "../lib/handicap";
import { localDate } from "../lib/local-date";
import { describeMatch,honourText,matchShareMessage,matchShareTitle,matchShareUrl,playerShareUrl,recordShareMessage,recordShareTitle,type RecordShareState } from "../lib/match-share";
import { recordStoryCard,resultStoryCard } from "../lib/story-card";
import ShareSheet from "./ShareSheet";
import { AppShell,PageFrame } from "./components/shell/AppShell";
import { AppHeader } from "./components/shell/AppHeader";
import { useT } from "./components/I18nProvider";
import { DesktopNavigation,MobileBottomNav,type Destination } from "./components/shell/Navigation";
import { addEntrant,buildBracket,canManageTournament,isTournamentHost,opponentIn,playerHonours,removeEntrant,reorderDraw,shuffleDraw,signupsClosed,swapPlayer,type BracketSlot,type Walkover } from "../lib/tournament";
import { Button,IconButton,InlineNotice } from "./components/ui/Primitives";
import { Sheet,ConfirmDialog,OverlayBackdrop } from "./components/ui/Overlay";
import { type Player,type MatchMode,type Match,type Tournament,type AppState,type StateLoadStatus,AUDIT_LOG_LIMIT,SAVE_CONFIRMATION_TIMEOUT_MS,fetchWithTimeout,mergeStatePayload,seed,games,frameRate,isParticipant,deletedPlayerPlaceholder,unselectedPlayerPlaceholder,teamLabel,teamRating,teamHandicap,recentDeltaDays,highestBreak,calc,replay,upgradeState,today,readStateCache,writeStateCache,TABS,normaliseTab,tabFromLocation,pushTabHistory } from "./home/model";
import { Leaderboard,HomeLoadingSkeleton } from "./home/Leaderboard";
import { Matches,cupFor,ConfirmDeleteMatch } from "./home/Matches";
import { Players,SettingsView } from "./home/Players";
import { MatchForm,SettingsForm } from "./home/MatchForm";
import { PlayerDetail } from "./home/PlayerDetail";

export default function Home({user,initialData}:{user:{displayName:string;email:string;role:"admin"|"member";statePlayerId?:string;needsOnboarding?:boolean}|null;initialData?:AppState|null}) {
  const t=useT();
  const [data,setData] = useState<AppState>(initialData ?? seed);
  const [stateLoadStatus,setStateLoadStatus] = useState<StateLoadStatus>(initialData ? "ready" : "loading");
  const [stateLoadError,setStateLoadError] = useState("");
  const [stateRetry,setStateRetry] = useState(0);
  const [,setStateLoadAttempt] = useState(0);
  const [tab,setTab] = useState("leaderboard");
  const [tourOpen,setTourOpen] = useState(false);
  /** Set by the onboarding hand-off link (`/?start=record`); the match form needs loaded club data, so it opens once the state is ready. */
  const startRecording = useRef(false);
  const [pendingConfirm,setPendingConfirm] = useState<{kicker:string;title:string;description:string;confirmLabel:string;onConfirm:()=>void}|null>(null);
  /** The post-match "加為常打對手" nudge -- set only when a freshly-saved 1v1 result is the first
      confirmed match between the viewer and their opponent. A personal, one-directional star, not a
      follow request: see db/regulars.pg.ts. */
  const [regularPrompt,setRegularPrompt] = useState<{id:string;name:string}|null>(null);
  const askConfirm=(opts:{kicker:string;title:string;description:string;confirmLabel:string;onConfirm:()=>void})=>setPendingConfirm(opts);
  /** Set by a player's 約戰 button; consumed once by `PlayBoard`, which opens the composer with that
      player invited. A fresh object on every tap lets a repeat tap on the same player re-open it. */
  const [playTarget,setPlayTarget] = useState<{playerId:string}|null>(null);
  /** A session id from a shared link (`?tab=play&session=…`); `PlayBoard` opens it once it has loaded. */
  const [playFocus,setPlayFocus] = useState<string|null>(null);
  const [matchesView,setMatchesView] = useState<"history"|"calendar"|"cup"|"matrix">("history");
  const [headToHead,setHeadToHead] = useState({a:"",b:""});
  const [highlightMatch,setHighlightMatch] = useState<string|null>(null);
  // localStorage can't be read during render without a hydration mismatch, so
  // the restore lands in an effect — which means the writer must skip its own
  // first run or it would persist the pre-restore default over the real value.
  const focusRestored = useRef(false);
  const [modal,setModal] = useState<"match"|"player"|"settings"|"detail"|"deleteMatch"|"tournament"|"signIn"|"share"|null>(null);
  const [detail,setDetail] = useState<Player|null>(null);
  /* What the share sheet is about. Held as the subject rather than as a built card so the card is
     rebuilt from live state — a result edited while the sheet is open must not be shared stale. */
  const [shareTarget,setShareTarget] = useState<{kind:"match";id:string}|{kind:"player";id:string}|null>(null);
  const [editingPlayer,setEditingPlayer] = useState<Player|null>(null);
  const [editingMatch,setEditingMatch] = useState<Match|null>(null);
  const [editingTournament,setEditingTournament] = useState<Tournament|null>(null);
  const [coHostSearch,setCoHostSearch] = useState("");
  const [deletingMatch,setDeletingMatch] = useState<Match|null>(null);
  const [toast,setToast] = useState("");
  const [undoSnapshot,setUndoSnapshot] = useState<AppState|null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [saving,setSaving] = useState(false);
  const [recordMenuOpen,setRecordMenuOpen] = useState(false);
  const [pullDistance,setPullDistance] = useState(0);
  const [refreshing,setRefreshing] = useState(false);
  const refreshingStateRef = useRef(false);
  /* The version of the club document currently on screen, so the background poll below can ask
     the server "still this one?" instead of re-downloading it. Kept in a ref rather than state
     because nothing renders from it and every write to it would otherwise cost a render. */
  const stateVersionRef = useRef("");
  const [draft,setDraft] = useState({mode:"1v1" as MatchMode,teamAName:"Team A",teamBName:"Team B",a:"",b:"",a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[] as {playerId:string;value:number}[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1,cupSlotLocked:false});
  const [playerForm,setPlayerForm] = useState({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});
  const [managementMode,setManagementMode] = useState(false);
  const ownPlayerId=user?.statePlayerId;
  /* The badge runs in the app shell, so a member looking at the leaderboard finds out that a result
     is waiting to be recorded or someone has invited them. Only things owed to *me* count. */
  const {count:playBadge,refresh:refreshPlay}=usePlayBadge(ownPlayerId);
  /* 球隊: the leaderboard filtered to one of the viewer's squads. Held in `?squad=` so a view can be
     shared and survives a reload; an id the viewer no longer belongs to falls back to the club. */
  const {squads,loaded:squadsLoaded,refresh:refreshSquads}=useSquads(Boolean(ownPlayerId));
  const squadId=useUrlParam("squad");
  const [squadSheet,setSquadSheet]=useState<SquadSheet>(null);
  const selectSquad=useCallback((id:string|null)=>writeUrlParam("squad",id),[]);
  /* A squad that can't be opened (private to this viewer, or gone) says so and returns to the club, instead of leaving a dead ?squad= link on screen. */
  const publicSquad=usePublicSquad(squadId,squads,ownPlayerId?squadsLoaded:true,message=>{setToast(message||t("搵唔到呢個球隊。"));selectSquad(null)});
  const activeSquad=squads.find(squad=>squad.id===squadId)??publicSquad;
  useSquadViewTracking(tab==="leaderboard"?activeSquad:null);
  const squadAction=(id:string,action:"leave"|"seen")=>{
    const path=`/api/squads/${encodeURIComponent(id)}`;
    const request=action==="seen"?fetch(`${path}/seen`,{method:"POST"})
      :fetch(`${path}/members?playerId=${encodeURIComponent(ownPlayerId??"")}`,{method:"DELETE"}).then(async response=>{
        if(!response.ok)setToast((await response.json().catch(()=>({})) as {error?:string}).error??t("未能更新球隊，請稍後再試。"));
      });
    void request.catch(()=>{}).finally(()=>void refreshSquads());
  };
  /* A shared session link is /?tab=play&session=ID. The tab and the session are read once on mount;
     later navigations go through the popstate handler below. */
  useEffect(()=>{
    const search=new URLSearchParams(window.location.search);
    const wanted=normaliseTab(search.get("tab"));
    if(wanted&&TABS.includes(wanted))setTab(wanted);
    const sharedSession=search.get("session");
    if(sharedSession)setPlayFocus(sharedSession);
    setManagementMode(search.get("manage")==="1");
    if(search.get("start")==="record"){startRecording.current=true;const url=new URL(window.location.href);url.searchParams.delete("start");window.history.replaceState(null,"",url)}
    /* The draw notification deep-links to the bracket itself, not merely to 比賽 — landing on the
       match history after being told who you drew is a dead end. */
    if(search.get("view")==="cup")setMatchesView("cup");
  },[]);
  const isAdmin=user?.role==="admin";
  // Primitive, so the state loader's dependency list can name it without the prop's identity
  // re-triggering a full club refetch on every parent render.
  const signedIn=Boolean(user);
  const [tournamentForm,setTournamentForm] = useState<{name:string;format:"single"|"double";handicapMode:"suggested"|"none";startAt:string;signupDeadline:string;coHosts:string[]}>({name:"",format:"single",handicapMode:"suggested",startAt:"",signupDeadline:`${today}T23:59`,coHosts:[]});
  const canManageMatch=(match:Match)=>Boolean(isAdmin||ownPlayerId&&isParticipant(match,ownPlayerId));
  const canManageCup=(tournament:Tournament)=>canManageTournament(tournament,ownPlayerId,Boolean(isAdmin));
  const canManageCupHosts=(tournament:Tournament)=>Boolean(isAdmin||isTournamentHost(tournament,ownPlayerId));
  /* Open cups are a discovery nudge: keep the number visible on 比賽 even for signed-out visitors,
     because anyone can browse the cup and see the route to signing up. */
  const openTournamentCount=useMemo(()=>data.tournaments.filter(tournament=>!signupsClosed(tournament)).length,[data.tournaments]);

  useEffect(()=>{
    const local = localStorage.getItem("elo-draft");
    if(local) try { setDraft(JSON.parse(local)); } catch {}
    /* The server already hydrated this page with the same state. Refetching it immediately adds
       database reads while the matchmaking summary and 約戰 board are trying to open. */
    if(initialData)return;
    let cancelled=false;
    let retryTimer:ReturnType<typeof setTimeout>|undefined;
    let requestController:AbortController|undefined;
    /* Show the cached club first, then reconcile with the server. The rating replay is the same
       one the network path runs, so what is on screen is never a different calculation — only an
       older set of matches, replaced the moment the server answers with something newer. */
    const cached=readStateCache();
    const apply=(document:AppState,version:string)=>{
      const upgraded=upgradeState(document);
      const loaded=upgraded.state;
      const replayed={...loaded,...replay(loaded.players,loaded.matches,loaded.settings)};
      setData(replayed);
      setStateLoadStatus("ready");
      setStateLoadError("");
      if(version)stateVersionRef.current=version;
      return {upgraded,loaded,replayed,version};
    };
    if(cached) try{ apply(cached.document,cached.version) }catch{}
    const load=async(attempt:number):Promise<void>=>{
      setStateLoadAttempt(attempt);
      requestController=new AbortController();
      const timeout=setTimeout(()=>requestController?.abort(),15000);
      try{
        const response=await fetch("/api/state",{
          cache:"no-store",
          signal:requestController.signal,
          /* `no-store` opts out of the browser's own revalidation, so the conditional request is
             made explicitly. An unchanged club then costs one small version query and an empty
             304 instead of the whole document. */
          headers:cached?{"if-none-match":`"${cached.version}"`}:undefined,
        });
        if(response.status===304&&cached){
          if(!cancelled)setStateLoadStatus("ready");
          return;
        }
        const value=await response.json().catch(()=>null) as Record<string,unknown>|null;
        if(!response.ok||!Array.isArray(value?.players)||!Array.isArray(value?.matches)){
          throw new Error(typeof value?.error==="string"?value.error:t("資料格式無效"));
        }
        if(cancelled)return;
        const document=value as AppState;
        const version=(response.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"");
        const {upgraded,loaded,replayed}=apply(document,version);
        writeStateCache(version,document);
        const replayChanged=JSON.stringify({players:loaded.players,matches:loaded.matches})!==JSON.stringify({players:replayed.players,matches:replayed.matches});
        /* Persisting the recomputed ratings keeps the server-rendered pages (/p, /m, /admin),
           which read stored values without replaying, in step. Only a signed-in visitor can
           write, so firing this for anyone else just spends a serverless invocation on a
           guaranteed 401. */
        if(signedIn&&(upgraded.changed||replayChanged))fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(replayed)}).catch(()=>{});
      }catch(error){
        if(cancelled)return;
        if(attempt<2){
          retryTimer=setTimeout(()=>void load(attempt+1),1000*2**attempt);
          return;
        }
        /* A visitor already looking at the cached club keeps it; a failed refresh is not a
           reason to replace real data with an error. */
        if(cached)return;
        setStateLoadStatus("failed");
        setStateLoadError(error instanceof Error&&error.name==="AbortError"?t("資料載入逾時。"):t("資料暫時未能載入。請稍後再試。"));
      }finally{clearTimeout(timeout)}
    };
    void load(0);
    return()=>{cancelled=true;clearTimeout(retryTimer);requestController?.abort()};
  },[initialData,stateRetry,signedIn, t]);
  async function refreshData(){
    if(refreshingStateRef.current)return;
    refreshingStateRef.current=true;
    try{
      /* Conditional, like the initial load. This runs every 15 seconds in every visible tab, so
         without the ETag it rebuilt and shipped the entire club document — every player, every
         match, every audit entry — several times a minute per member, almost always to discover
         nothing had changed. The server answers an unchanged club with an empty 304 costing one
         indexed fingerprint query. */
      const version=stateVersionRef.current;
      const r=await fetch("/api/state",{cache:"no-store",headers:version?{"if-none-match":`"${version}"`}:undefined});
      if(r.status===304)return;
      const v=r.ok?await r.json():null;
      if(v?.players){
        const next=(r.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"");
        if(next)stateVersionRef.current=next;
        setData(upgradeState(v).state);
      }
    }catch{}
    finally{refreshingStateRef.current=false}
  }
  useEffect(()=>{
    const timer=setInterval(()=>{
      if(document.visibilityState!=="visible"||saving)return;
      refreshData();
    },15000);
    return ()=>clearInterval(timer);
  },[saving]);
  // Standalone/PWA mode drops the browser's native pull-to-refresh along with
  // its chrome, so members on the home-screen app have no gesture at all for
  // "someone else might have just recorded a match" — this reimplements it by
  // hand, only engaging when the page is already scrolled to the very top so
  // it can't hijack an ordinary upward scroll mid-page.
  const pullStart = useRef<number|null>(null);
  const PULL_THRESHOLD = 72;
  useEffect(()=>{
    const onTouchStart=(e:TouchEvent)=>{
      if(window.scrollY>0||refreshing)return;
      pullStart.current=e.touches[0].clientY;
    };
    const onTouchMove=(e:TouchEvent)=>{
      if(pullStart.current==null)return;
      const delta=e.touches[0].clientY-pullStart.current;
      if(delta<=0){setPullDistance(0);return;}
      if(window.scrollY>0){pullStart.current=null;setPullDistance(0);return;}
      setPullDistance(Math.min(delta,PULL_THRESHOLD*1.5));
    };
    const onTouchEnd=async ()=>{
      if(pullStart.current==null)return;
      pullStart.current=null;
      const shouldRefresh=pullDistance>=PULL_THRESHOLD;
      setPullDistance(0);
      if(!shouldRefresh)return;
      setRefreshing(true);
      await refreshData();
      setRefreshing(false);
    };
    window.addEventListener("touchstart",onTouchStart,{passive:true});
    window.addEventListener("touchmove",onTouchMove,{passive:true});
    window.addEventListener("touchend",onTouchEnd);
    return ()=>{
      window.removeEventListener("touchstart",onTouchStart);
      window.removeEventListener("touchmove",onTouchMove);
      window.removeEventListener("touchend",onTouchEnd);
    };
  },[pullDistance,refreshing]);
  useEffect(()=>{ localStorage.setItem("elo-draft",JSON.stringify(draft)); },[draft]);
  // The match tab is egocentric in practice — a member opens it to check their
  // own last result, not the club archive. Restore whatever they were last
  // looking at; failing that, start a signed-in member on their own record.
  useEffect(()=>{
    const stored=localStorage.getItem("elo-match-focus");
    if(stored){
      try{
        const value=JSON.parse(stored);
        if(typeof value?.a==="string"&&typeof value?.b==="string"){setHeadToHead({a:value.a,b:value.b});return;}
      }catch{}
    }
    if(ownPlayerId)setHeadToHead({a:ownPlayerId,b:""});
  },[ownPlayerId]);
  useEffect(()=>{
    if(!focusRestored.current){focusRestored.current=true;return;}
    localStorage.setItem("elo-match-focus",JSON.stringify(headToHead));
  },[headToHead]);
  // A restored id can outlive the player it points at; drop it once the roster
  // arrives so the filter never names someone who is no longer in the club.
  useEffect(()=>{
    if(!data.players.length)return;
    setHeadToHead(pair=>{
      const known=(id:string)=>!id||data.players.some(p=>p.id===id);
      if(known(pair.a)&&known(pair.b))return pair;
      return known(pair.a)?{a:pair.a,b:""}:{a:"",b:""};
    });
  },[data.players]);
  // Navigating away retires the highlight, so returning later doesn't re-flash
  // a result the user has already seen. Cleared on the click rather than in an
  // effect keyed on `tab` — saveMatch sets both in one batch, and an effect
  // would race that.
  /* Tabs are client state, so without a history entry per tab the phone's back gesture left the app
     entirely instead of returning to the previous tab (and to the guest introduction). */
  const showTab=(next:string)=>{setTab(next);if(next!==tab)pushTabHistory(next)};
  const goTab=(next:string)=>{setRecordMenuOpen(false);setHighlightMatch(null);if(next!=="play")setPlayTarget(null);window.scrollTo(0,0);showTab(next)};
  const closeTour=useCallback(()=>setTourOpen(false),[]);
  useEffect(()=>{if(startRecording.current&&stateLoadStatus==="ready"){startRecording.current=false;if(user&&!user.needsOnboarding)newMatch()}},[stateLoadStatus]);// eslint-disable-line react-hooks/exhaustive-deps -- newMatch reads current state; run once when ready
  const tabRef=useRef(tab);
  useEffect(()=>{tabRef.current=tab});
  useEffect(()=>{
    const onPop=()=>{
      const wanted=tabFromLocation();
      if(wanted===tabRef.current)return;
      setRecordMenuOpen(false);setHighlightMatch(null);setTab(wanted);window.scrollTo(0,0);
    };
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[]);
  useEffect(()=>{
    if(data.players.length<2)return;
    setDraft(d=>{
      const validA=data.players.some(p=>p.id===d.a);
      const validB=data.players.some(p=>p.id===d.b);
      const validA2=data.players.some(p=>p.id===d.a2);
      const validB2=data.players.some(p=>p.id===d.b2);
      if(validA&&validB&&d.a!==d.b&&(d.mode!=="2v2"||(
        validA2&&validB2&&d.a!==d.a2&&d.b!==d.b2&&d.a!==d.b&&d.a2!==d.b2)))return d;
      const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
      return {...d,mode:d.mode||"1v1",a:sorted[0]?.id??"",b:sorted[1]?.id??"",a2:"",b2:"",giver:""};
    });
  },[data.players]);

  // `undo` holds the pre-change snapshot; while the toast is on screen it can be persisted back.
  const sessionOrigin=useRef<string|null>(null);
  async function persist(rawNext:AppState,message:string,undo?:AppState) {
    if(!user){setToast(t("請先登入會員帳戶，才可更改球會資料。"));return;}
    const baseline=data;
    // The audit log is prepended to on every write and the UI only ever shows the first 12 entries,
    // so an old club's full history is dead weight in every save from here on — weight that,
    // uncapped, eventually pushes a save past the platform's request-size limit and fails the least
    // forgiving action to retry: recording a match.
    const next=rawNext.audits.length>AUDIT_LOG_LIMIT?{...rawNext,audits:rawNext.audits.slice(0,AUDIT_LOG_LIMIT)}:rawNext;
    setData(next); setSaving(true);
    if(toastTimer.current) clearTimeout(toastTimer.current);
    if(undoTimer.current) clearTimeout(undoTimer.current);
    const restorable=Boolean(undo);
    setToast(message);
    setUndoSnapshot(restorable?undo??null:null);
    if(restorable)undoTimer.current=setTimeout(()=>setUndoSnapshot(null),2600);
    toastTimer.current=setTimeout(()=>{setToast("");setUndoSnapshot(null)},restorable?2600:3200);
    try {
      // Merging onto `latest` closes most of the gap, but two saves can still both fetch
      // `latest` before either PUT lands — each merges onto the same base and one silently
      // overwrites the other. The server rejects a PUT whose base version has moved on since,
      // so a genuine race surfaces as a 409 here instead of a lost write; re-running the fetch
      // + merge + PUT once against the now-current document resolves it in the common case.
      for(let attempt=0;attempt<3;attempt++){
        const latestResponse=await fetchWithTimeout("/api/state",{cache:"no-store"}).catch(()=>null);
        const latest=latestResponse?.ok?await latestResponse.json().catch(()=>null):null;
        const baseVersion=(latestResponse?.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"");
        const payload=mergeStatePayload(next,baseline,latest);
        const r=await fetchWithTimeout("/api/state",{method:"PUT",headers:{"content-type":"application/json",...(baseVersion?{"if-match":`"${baseVersion}"`}:{})},body:JSON.stringify(payload)});
        if(r.status===409&&attempt<2)continue;
        if(!r.ok){
          const body=await r.json().catch(()=>null);
          throw new Error(typeof body?.error==="string"?body.error:"");
        }
        break;
      }
      return true;
    } catch (error) {
      if(toastTimer.current)clearTimeout(toastTimer.current);
      if(undoTimer.current)clearTimeout(undoTimer.current);
      setUndoSnapshot(null);
      /* A timeout is not proof of failure. fetchWithTimeout aborts the request from this side; the
         write it was waiting on may well have committed on the server a moment later. Confirm the
         save marker below before showing an uncertainty notice. This also avoids surfacing the
         browser's own untranslated abort text — "signal is aborted without reason" — to members. */
      const aborted=error instanceof Error&&error.name==="AbortError";
      if(aborted){
        /* PUT writes the state before it finishes syncing the member profile rows. If that
           follow-up is slow, the client can time out after the document — including this fresh
           audit entry — is already durable. Confirm the marker once before showing an uncertainty
           notice, so a slow response does not look like a failed save. */
        const auditId=next.audits[0]?.id;
        const confirmation=await fetchWithTimeout("/api/state",{cache:"no-store"},SAVE_CONFIRMATION_TIMEOUT_MS)
          .then(async response=>{
            if(!response.ok)return null;
            const document=await response.json().catch(()=>null) as Record<string,unknown>|null;
            return document?{document,version:(response.headers.get("etag")??"").replace(/^W\//,"").replace(/"/g,"")}:null;
          })
          .catch(()=>null);
        const saved=Boolean(auditId&&Array.isArray(confirmation?.document.audits)&&confirmation.document.audits.some(entry=>entry&&typeof entry==="object"&&(entry as {id?:unknown}).id===auditId));
        if(saved){
          if(confirmation?.version)stateVersionRef.current=confirmation.version;
          setData(upgradeState(confirmation!.document as AppState).state);
          setToast(message);
          toastTimer.current=setTimeout(()=>setToast(""),3200);
          return true;
        }
      }
      const reason=aborted?"":error instanceof Error?error.message:"";
      setToast(aborted?t("伺服器回應逾時，未能確認是否已儲存。請重新整理頁面查看最新資料。")
        :reason?t("未能儲存：{reason}", {reason})
        :t("未能連接伺服器；資料仍保留在此畫面，請稍後再試。"));
      toastTimer.current=setTimeout(()=>setToast(""),aborted?5200:3200);
    } finally { setSaving(false); }
  }
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);if(undoTimer.current)clearTimeout(undoTimer.current)},[]);

  function resetAll(){
    if(user?.role!=="admin"){setToast(t("只有管理員可以清除並重設資料。"));return;}
    const typed=prompt(t("此操作會永久刪除所有球員、比賽及審計記錄。請輸入 RESET 繼續："));
    if(typed!=="RESET")return;
    askConfirm({kicker:t("清除並重設資料"),title:t("最後確認"),description:t("清除並重設所有共用資料？此操作無法復原。"),confirmLabel:t("清除並重設"),onConfirm:doResetAll});
  }
  async function doResetAll(){
    setSaving(true);
    try{
      const response=await fetch("/api/state",{method:"DELETE"});
      if(!response.ok)throw new Error();
      const fresh=await response.json();
      setData(fresh);
      localStorage.removeItem("elo-draft");
      setDraft({mode:"1v1",teamAName:"Team A",teamBName:"Team B",a:"",b:"",a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1,cupSlotLocked:false});
      setToast(t("所有共用資料已清除並重設。"));
    }catch{setToast(t("重設失敗，資料沒有被清除。請稍後再試。"));}
    finally{setSaving(false);setUndoSnapshot(null);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(""),3200);}
  }

  function deleteTournament(tournament:Tournament){
    if(!isAdmin){setToast(t("只有管理員可以刪除盃賽。"));return;}
    askConfirm({kicker:t("刪除盃賽"),title:t("確定刪除「{name}」？", {name: tournament.name}),description:t("盃賽及其已記錄賽事都會永久刪除。"),confirmLabel:t("永久刪除"),onConfirm:()=>{
      const matches=data.matches.filter(match=>match.tournamentId!==tournament.id);
      const base={...data,tournaments:data.tournaments.filter(item=>item.id!==tournament.id),matches,audits:[{id:crypto.randomUUID(),text:`刪除盃賽：${tournament.name}`,at:new Date().toISOString()},...data.audits]};
      const settings=data.settings,next={...base,settings,...replay(data.players,matches,settings)};
      setData(next);persist(next,t("盃賽已刪除。"),data);
    }});
  }

  const ranked=useMemo(()=>[...data.players].sort((a,b)=>b.rating-a.rating||games(b)-games(a)||a.name.localeCompare(b.name)),[data]);
  const a=data.players.find(p=>p.id===draft.a)??(draft.a?deletedPlayerPlaceholder(draft.a,data.settings.start):data.players[0]??unselectedPlayerPlaceholder(data.settings.start));
  const b=data.players.find(p=>p.id===draft.b)??(draft.b?deletedPlayerPlaceholder(draft.b,data.settings.start):data.players[1]??unselectedPlayerPlaceholder(data.settings.start));
  const a2=data.players.find(p=>p.id===draft.a2);
  const b2=data.players.find(p=>p.id===draft.b2);
  const valid2v2 = draft.mode==="2v2" && a && b && a2 && b2 && new Set([a.id,b.id,a2.id,b2.id]).size===4;
  const teamMatch = {a:a?.id??"",b:b?.id??"",a2:a2?.id,b2:b2?.id,mode:draft.mode,teamAName:draft.teamAName?.trim()||"Team A",teamBName:draft.teamBName?.trim()||"Team B"} as Match;
  const aEntity = draft.mode==="2v2" && valid2v2 ? {
    id:"teamA",name:teamLabel(teamMatch,data,"A"),short:teamLabel(teamMatch,data,"A"),handicap:teamHandicap(teamMatch,data,"A"),rating:teamRating(teamMatch,data,"A"),initialRating:0,active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]
  } as Player : a;
  const bEntity = draft.mode==="2v2" && valid2v2 ? {
    id:"teamB",name:teamLabel(teamMatch,data,"B"),short:teamLabel(teamMatch,data,"B"),handicap:teamHandicap(teamMatch,data,"B"),rating:teamRating(teamMatch,data,"B"),initialRating:0,active:false,wins:0,losses:0,draws:0,framesWon:0,framesLost:0,lastChange:0,form:[]
  } as Player : b;
  const preview=a&&b&&(!draft.mode||draft.mode==="1v1"||valid2v2||draft.mode==="cup")
    ? calc(aEntity,bEntity,+draft.scoreA,+draft.scoreB,draft.giver,Math.max(0,Math.trunc(+draft.points||0)),data.settings,
        draft.mode==="2v2"?([a.id,a2?.id].includes(draft.giver) ? "A" : [b.id,b2?.id].includes(draft.giver) ? "B" : undefined):undefined)
    : null;
  const openHeadToHead=(player:Player,selectedOpponent?:Player)=>{
    const opponent=selectedOpponent??data.players.find(candidate=>candidate.id!==player.id&&candidate.active)??data.players.find(candidate=>candidate.id!==player.id);
    setHeadToHead({a:player.id,b:opponent?.id??""});
    setMatchesView("history");
    goTab("matches");
  };
  const openPlayerMatches=(player:Player)=>{
    setHeadToHead({a:player.id,b:""});
    setMatchesView("history");
    goTab("matches");
  };
  const jumpToPlayerAvailability=(playerId:string)=>{
    setModal(null);
    setPlayTarget({playerId});
    goTab("play");
  };

  function saveMatch(){
    if(saving)return;
    if(!isAdmin&&(!ownPlayerId||(a?.id!==ownPlayerId&&b?.id!==ownPlayerId&&a2?.id!==ownPlayerId&&b2?.id!==ownPlayerId))){setToast(t("你只能記錄或修改自己參與的比賽。"));return;}
    const valid1v1 = draft.mode==="1v1";
    const valid2v2 = draft.mode==="2v2" && a && b && a2 && b2 && new Set([a.id,b.id,a2.id,b2.id]).size===4;
    const validCup = draft.mode==="cup" && Boolean(draft.tournamentId&&draft.a&&draft.b&&a&&b) && Number(draft.tournamentRound)>=1 && Number(draft.tournamentMatchIndex)>=1;
    if(!valid1v1 && !valid2v2 && !validCup){setToast(t("請選擇有效賽事配置；盃賽賽果需選擇盃賽、輪次和場次。"));return;}
    if(draft.scoreA<0||draft.scoreB<0||(+draft.scoreA+ +draft.scoreB)===0){setToast(t("比分總局數必須大於 0。"));return;}
    if(!preview)return;
    const now=new Date().toISOString(), id=editingMatch?.id??crypto.randomUUID();
    const beforeA = a.rating;
    const beforeB = b.rating;
    const entertainment=valid2v2;
    const match:Match={id,a:a.id,b:b.id,mode:draft.mode,teamAName:valid2v2?(draft.teamAName?.trim()||"Team A"):undefined,teamBName:valid2v2?(draft.teamBName?.trim()||"Team B"):undefined,scoreA:+draft.scoreA,scoreB:+draft.scoreB,playedOn:draft.date||today,
      a2:valid2v2?String(draft.a2):undefined,b2:valid2v2?String(draft.b2):undefined,
      actual:preview.actual,giver:draft.giver||null,official:preview.official,extra:preview.extra,expectedA:preview.expectedA,
      beforeA,beforeB,afterA:entertainment?beforeA:beforeA+preview.deltaA,afterB:entertainment?beforeB:beforeB-preview.deltaA,deltaA:entertainment?0:preview.deltaA,
      entryMode:"match",highBreaks:valid2v2?[]:(draft.highBreaks??[]).filter((item:{playerId:string;value:number})=>(item.playerId===a.id||item.playerId===b.id)&&item.value>0&&item.value<=147),
      frameEvidence:preview.frameEvidence,performanceScore:preview.performanceScore,evidenceWeight:preview.evidenceWeight,handicapAdjustment:preview.adjustment,overHandicapElo:preview.overHandicapElo,overHandicapMultiplier:preview.overHandicapMultiplier,status:"confirmed",createdAt:editingMatch?.createdAt??now,
      tournamentId:validCup?String(draft.tournamentId):undefined,tournamentRound:validCup?Math.max(1,Number(draft.tournamentRound)||1):undefined,tournamentMatchIndex:validCup?Math.max(1,Number(draft.tournamentMatchIndex)||1):undefined};
    if(valid2v2){
      match.beforeA2=a2!.rating;match.beforeB2=b2!.rating;
      match.afterA2=a2!.rating;match.afterB2=b2!.rating;
    }
    // Checked against the *old* `data.matches`, before this match joins it, and only for a genuinely
    // new 1v1 result the viewer played themselves -- not an edit, not 2v2/cup (paired by bracket or
    // teams, not by choice), not a match an admin is logging on someone else's behalf.
    const firstPairing=valid1v1&&!editingMatch&&ownPlayerId&&(a.id===ownPlayerId||b.id===ownPlayerId)
      ?(a.id===ownPlayerId?b:a):null;
    const isNewPairing=Boolean(firstPairing)&&!data.matches.some(existing=>
      existing.status==="confirmed"&&((existing.a===a.id&&existing.b===b.id)||(existing.a===b.id&&existing.b===a.id)));
    const matches=editingMatch
      ? data.matches.map(existing=>existing.id===editingMatch.id?match:existing)
      : [match,...data.matches];
    const settings=data.settings;
    const rebuilt=replay(data.players,matches,settings);
    const action=editingMatch?t("編輯"):t("記錄");
    const matchLabel=valid2v2?`${teamLabel(match,data,"A")} ${draft.scoreA}–${draft.scoreB} ${teamLabel(match,data,"B")}`:`${a.name} ${draft.scoreA}–${draft.scoreB} ${b.name}`;
    const next={...data,settings,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}${valid2v2?t("潮拍娛樂賽"):validCup?t("盃賽賽果"):t("賽果")}：${matchLabel}${valid2v2?t("；不影響 ELO"):validCup?t("；盃賽第 {tournamentRound} 輪第 {tournamentMatchIndex} 場", {tournamentRound: match.tournamentRound, tournamentMatchIndex: match.tournamentMatchIndex}):t("；重播歷史 ELO")}`,at:now},...data.audits]};
    localStorage.removeItem("elo-draft"); setEditingMatch(null); setModal(null);
    // Land on the saved card rather than a toast that vanishes: focus the list
    // on the recorder (or clear it, for an admin logging someone else's game)
    // so the new row is guaranteed to be in the filtered set, and drop the
    // comparison — the date range only applies while comparing, and a stale
    // range could otherwise hide the very match we just navigated to.
    setHeadToHead({a:ownPlayerId&&(match.a===ownPlayerId||match.b===ownPlayerId)?ownPlayerId:"",b:""});
    setHighlightMatch(id); setMatchesView("history"); showTab("matches");
    const origin=sessionOrigin.current;sessionOrigin.current=null;
    void persist(next,valid2v2?(editingMatch?t("潮拍 2v2 已更新；ELO 與統計維持不變。"):t("潮拍 2v2 賽果已儲存；ELO 與統計維持不變。")):(validCup?(editingMatch?t("盃賽賽果已更新。"):t("盃賽賽果已儲存。")):(editingMatch?t("賽事已更新，所有後續 ELO 已重建。"):t("賽果已儲存，雙方 ELO 已更新。")))).then(async saved=>{if(!saved||!origin)return;try{const response=await fetch("/api/play/results",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"link",sessionId:origin,matchId:id})});if(!response.ok)setToast(t("賽果已儲存，但未能連結約戰安排。"));}catch{setToast(t("賽果已儲存，但未能連結約戰安排。"));}});
    if(isNewPairing&&firstPairing)setRegularPrompt({id:firstPairing.id,name:firstPairing.name});
  }

  const addRegularNow=()=>{
    if(!regularPrompt)return;
    void fetch("/api/regulars",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:regularPrompt.id})})
      .catch(()=>{/* best effort -- worst case the member stars them again from the board later */});
    setRegularPrompt(null);
  };

  function editMatch(m:Match){
    sessionOrigin.current=null;
    if(!canManageMatch(m)){setToast(t("你只能修改自己參與的比賽。"));return;}
    setEditingMatch(m);
    setDraft({
      mode:m.mode??"1v1",teamAName:m.teamAName?.trim()||"Team A",teamBName:m.teamBName?.trim()||"Team B",a:m.a,b:m.b,a2:m.a2??"",b2:m.b2??"",scoreA:m.scoreA,scoreB:m.scoreB,
      date:m.playedOn,giver:m.actual>0?m.a:m.actual<0?m.b:"",points:Math.abs(m.actual),highBreaks:m.highBreaks??[],tournamentId:m.tournamentId??"",tournamentRound:m.tournamentRound??1,tournamentMatchIndex:m.tournamentMatchIndex??1,
      // Editing an existing cup result must not offer to re-pick the pairing either: the box it
      // belongs to is already decided.
      cupSlotLocked:m.mode==="cup"
    });
    setModal("match");
  }

  function newMatch(mode:MatchMode="1v1",opponentId?:string,playedOn?:string){
    sessionOrigin.current=null;
    setRecordMenuOpen(false);
    if(!user){setModal("signIn");return;}
    setEditingMatch(null);
    const sorted=[...data.players].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,"zh-HK"));
    const first=ownPlayerId&&sorted.some(player=>player.id===ownPlayerId)?ownPlayerId:sorted[0]?.id??"";
    const remaining=sorted.filter(player=>player.id!==first);
    const second=opponentId&&opponentId!==first&&remaining.some(player=>player.id===opponentId)?opponentId:remaining[0]?.id??"";
    const rest=remaining.filter(player=>player.id!==second);
    setDraft({
      mode,teamAName:"Team A",teamBName:"Team B",a:first,b:second,
      a2:mode==="2v2"?rest[0]?.id??"":"",b2:mode==="2v2"?rest[1]?.id??"":"",
      scoreA:0,scoreB:0,date:playedOn??localDate(),giver:"",points:0,highBreaks:[],tournamentId:"",tournamentRound:1,tournamentMatchIndex:1,cupSlotLocked:false
    });
    setModal("match");
  }

  function savePlayer(){
    if(!isAdmin&&(!editingPlayer||editingPlayer.id!==ownPlayerId)){setToast(t("你只能修改自己的球員資料。"));return;}
    if(!playerForm.name.trim()||!playerForm.short.trim()){setToast(t("請輸入顯示名稱及縮寫。"));return;}
    const requestedRating=playerForm.rating.trim()===""?NaN:Number(playerForm.rating);
    const rating=editingPlayer
      ? isAdmin&&Number.isFinite(requestedRating)?requestedRating:editingPlayer.initialRating
      : isAdmin&&Number.isFinite(requestedRating)?requestedRating:data.settings.start;
    if(!Number.isFinite(rating)||rating<200||rating>3000){setToast(t("個人起始 ELO 必須介乎 200 至 3000。"));return;}
    const p:Player=editingPlayer
      ? {...editingPlayer,name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),handicap:playerForm.handicap===""?null:+playerForm.handicap,initialRating:rating,colour:playerForm.colour||DEFAULT_AVATAR}
      : {id:crypto.randomUUID(),name:playerForm.name.trim(),short:playerForm.short.toUpperCase().slice(0,3),colour:playerForm.colour||DEFAULT_AVATAR,
        handicap:playerForm.handicap===""?null:+playerForm.handicap,rating,initialRating:rating,active:true,wins:0,losses:0,draws:0,
        framesWon:0,framesLost:0,lastChange:0,form:[]};
    const action=editingPlayer?t("編輯"):t("新增");
    const players=editingPlayer?data.players.map(x=>x.id===p.id?p:x):[...data.players,p];
    const rebuilt=editingPlayer?replay(players,data.matches,data.settings):{players,matches:data.matches};
    const next={...data,...rebuilt,audits:[{id:crypto.randomUUID(),text:`${action}球員：${p.name}${editingPlayer?t("；重播歷史評分"):""}`,at:new Date().toISOString()},...data.audits]};
    setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal(null);persist(next,editingPlayer?t("球員資料已更新。"):t("球員已新增。"));
  }

  function editPlayer(p:Player){
    if(!isAdmin&&p.id!==ownPlayerId){setToast(t("你只能修改自己的球員資料。"));return;}
    setEditingPlayer(p);
    setPlayerForm({name:p.name,short:p.short,handicap:p.handicap==null?"":String(p.handicap),rating:String(Math.round(p.initialRating)),colour:p.colour||DEFAULT_AVATAR});
    setModal("player");
  }

  function deletePlayer(p:Player){
    if(!isAdmin){setToast(t("只有管理員可以刪除球員。"));return;}
    const hasHistory=data.matches.some(m=>m.a===p.id||m.b===p.id);
    askConfirm({kicker:t("刪除球員"),title:t("永久刪除 {name}？", {name: p.name}),description:t("{v}此操作無法復原。", {v: hasHistory?t("歷史賽事會保留並顯示為「已刪除球員」。"):""}),confirmLabel:t("永久刪除"),onConfirm:()=>{
      const next={...data,players:data.players.filter(x=>x.id!==p.id),
        audits:[{id:crypto.randomUUID(),text:`永久刪除球員：${p.name}`,at:new Date().toISOString()},...data.audits]};
      persist(next,t("球員已永久刪除。"));
    }});
  }

  function closeModal(){ setModal(null); setDeletingMatch(null); setShareTarget(null); }

  /* Everything the share sheet needs, derived from live state at render time. Both surfaces — the
     WhatsApp text and the story image — come off the same description, so the message and the
     picture can never disagree about who won. */
  const sharePayload=useMemo(()=>{
    if(!shareTarget)return null;
    const origin=typeof window==="undefined"?"":window.location.origin;
    if(shareTarget.kind==="match"){
      const match=data.matches.find(item=>item.id===shareTarget.id);
      if(!match)return null;
      const state=describeMatch(t, match,data.players,cupFor(t, match,data));
      const url=matchShareUrl(origin,match.id);
      return {card:resultStoryCard(t, state,url),message:matchShareMessage(t, state,url),url,title:matchShareTitle(state)};
    }
    const player=data.players.find(item=>item.id===shareTarget.id);
    if(!player)return null;
    const played=games(player);
    const state:RecordShareState={
      name:player.name,short:player.short,colour:player.colour??null,avatar:player.avatar??null,
      rank:ranked.findIndex(item=>item.id===player.id)+1,
      rating:Math.round(player.rating),
      provisional:played<data.settings.provisionalGames,
      played,wins:player.wins,losses:player.losses,draws:player.draws,
      frameRate:frameRate(player),
      highestBreak:highestBreak(player,data)??0,
      form:player.form.slice(0,5),
      swing:Math.round(recentDeltaDays(player,data,10)),
      honours:playerHonours(data.tournaments,data.matches,player.id),
    };
    const url=playerShareUrl(origin,player.id);
    return {card:recordStoryCard(state,url,honourText(t, state.honours)),message:recordShareMessage(t, state,url),url,title:recordShareTitle(state)};
  },[shareTarget,data,ranked, t]);

  function shareMatch(match:Match){ setShareTarget({kind:"match",id:match.id}); setModal("share"); }
  function sharePlayer(player:Player){ setShareTarget({kind:"player",id:player.id}); setModal("share"); }

  function requestDeleteMatch(m:Match){ setDeletingMatch(m); setModal("deleteMatch"); }

  function confirmDeleteMatch(){
    const m=deletingMatch;
    if(!m)return;
    const snapshot=data;
    const matches=data.matches.filter(x=>x.id!==m.id);
    const entertainment=isEntertainmentMode(m.mode);
    const settings=data.settings;
    const rebuilt=replay(data.players,matches,settings);
    const next={...data,settings,...rebuilt,
      audits:[{id:crypto.randomUUID(),text:`永久刪除賽事：${m.id.slice(0,8)}${entertainment?t("；娛樂記錄，不影響評分"):t("；重建評分及近況")}`,at:new Date().toISOString()},...data.audits]};
    setDeletingMatch(null); setModal(null);
    persist(next,entertainment?t("娛樂賽事已刪除；ELO 與統計維持不變。"):t("賽事已刪除，ELO、統計及近況已重建。"),snapshot);
  }

  function undoDelete(){
    const snapshot=undoSnapshot;
    if(!snapshot)return;
    setUndoSnapshot(null);
    if(undoTimer.current)clearTimeout(undoTimer.current);
    // Restore the exact pre-delete state, but keep the rewind itself traceable.
    persist({...snapshot,audits:[{id:crypto.randomUUID(),text:"復原已刪除的賽事；還原評分及近況",at:new Date().toISOString()},...snapshot.audits]},t("已復原賽事，ELO 及統計已還原。"));
  }

  /* Recording from the bracket box rather than from a blank form. The round and match index travel
     with the tap, so they can no longer disagree with the tie the member was looking at — and the
     pairing is locked in the form, because a cup slot's two players are not a choice. */
  function recordCupSlot(tournament:Tournament,slot:BracketSlot<Match>){
    if(!user){setModal("signIn");return;}
    if(!isAdmin&&ownPlayerId!==slot.a&&ownPlayerId!==slot.b){setToast(t("你只能記錄自己參與的盃賽場次。"));return;}
    setRecordMenuOpen(false);
    setEditingMatch(null);
    /* The member enters their own score first, so their own name leads. The bracket reads scores by
       player id rather than by side, so leading with either player is safe. */
    const first=ownPlayerId===slot.b?slot.b:slot.a,second=first===slot.a?slot.b:slot.a;
    setDraft(current=>({...current,mode:"cup",teamAName:"Team A",teamBName:"Team B",a:first,b:second,a2:"",b2:"",scoreA:0,scoreB:0,date:today,giver:"",points:0,highBreaks:[],
      tournamentId:tournament.id,tournamentRound:slot.round,tournamentMatchIndex:slot.index,cupSlotLocked:true}));
    setModal("match");
  }
  const arrangeCupMatch=(opponentId:string)=>{if(opponentId)jumpToPlayerAvailability(opponentId)};
  /* A tie nobody ever plays used to have exactly one remedy: invent a score. A walkover advances the
     bracket without fabricating a result — no frames, no ELO, and reversible. */
  function declareWalkover(tournament:Tournament,slot:BracketSlot<Match>,winnerId:string){
    if(!canManageCup(tournament)){setToast(t("只有盃賽主持人或協辦主持人可以判定晉級。"));return;}
    const playerName=(id:string)=>data.players.find(player=>player.id===id)?.name??t("該球員");
    const apply=()=>{
      const others=(tournament.walkovers??[]).filter(item=>!(item.round===slot.round&&item.index===slot.index));
      const walkovers:Walkover[]=winnerId?[...others,{round:slot.round,index:slot.index,winner:winnerId}]:others;
      const tournaments=data.tournaments.map(item=>item.id===tournament.id?{...item,walkovers}:item);
      const text=winnerId?t("判定晉級：{name} 第 {round} 輪第 {index} 場 — {v}", {name: tournament.name, round: slot.round, index: slot.index, v: playerName(winnerId)}):t("取消判定晉級：{name} 第 {round} 輪第 {index} 場", {name: tournament.name, round: slot.round, index: slot.index});
      const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text,at:new Date().toISOString()},...data.audits]};
      setData(next);persist(next,winnerId?t("已判定晉級。"):t("已取消判定晉級。"),data);
    };
    if(winnerId)askConfirm({kicker:t("判定晉級"),title:t("判定「{v}」因對手棄權晉級？", {v: playerName(winnerId)}),description:t("不會產生賽果，亦不影響 ELO。"),confirmLabel:t("確定判定"),onConfirm:apply});
    else apply();
  }

  /* The roster is an admin's to edit, because the reasons it goes wrong are all off-app: a member
     signs up under the wrong account, a reserve takes a no-show's place the morning of the tie, a
     name is entered twice. Before the draw that is a plain edit of the sign-up list. After it the
     list *is* the bracket, so a replacement goes through `swapPlayer`, which moves the player inside
     the frozen draw rather than re-running it — re-running would re-pair everyone already told who
     they are playing. Adding and removing stay open after the draw too, but only until somebody plays:
     both re-lay the whole field, so past the first result the non-disruptive tools take over — a
     swap for a substitution, a walkover for a no-show. */
  /* Once the draw is frozen, a roster edit (swap, reshuffle, or a dragged reorder) goes through the
     server so the entrants whose opponent actually moved get told again — the same job the initial
     draw does. Before the freeze it is a plain edit of the sign-up list with nothing to announce, so
     that path still writes straight through `persist`. */
  async function submitRedraw(tournament:Tournament,body:{action:"shuffle"}|{action:"reorder";draggedId:string;targetId:string}|{action:"swap";outgoingId:string;incomingId:string}|{action:"add";playerId:string}|{action:"remove";playerId:string},message:string){
    if(!user){setToast(t("請先登入會員帳戶，才可更改球會資料。"));return;}
    setSaving(true);
    try{
      const r=await fetch(`/api/tournaments/${tournament.id}/redraw`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const json=await r.json().catch(()=>null);
      if(!r.ok)throw new Error(typeof json?.error==="string"?json.error:"");
      setToast(message);
      if(toastTimer.current)clearTimeout(toastTimer.current);
      toastTimer.current=setTimeout(()=>setToast(""),3200);
      await refreshData();
    }catch(error){
      setToast(error instanceof Error&&error.message?error.message:t("更新失敗，請重試。"));
    }finally{
      setSaving(false);
    }
  }

  function editCupRoster(tournament:Tournament,outgoingId:string,incomingId:string){
    if(!canManageCup(tournament)){setToast(t("只有盃賽主持人或協辦主持人可以編輯報名名單。"));return;}
    const playerName=(id:string)=>data.players.find(player=>player.id===id)?.name??t("該球員");
    const drawn=Boolean(tournament.draw?.length);
    const apply=(updated:Tournament,text:string,message:string)=>{
      const tournaments=data.tournaments.map(item=>item.id===tournament.id?updated:item);
      const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text,at:new Date().toISOString()},...data.audits]};
      setData(next);persist(next,message,data);
    };
    if(outgoingId&&incomingId){
      const message=t("已更換參賽球員。");
      if(drawn){
        const precheck=swapPlayer(t, tournament,outgoingId,incomingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        /* Two entrants trading boxes and a reserve taking one are the same edit to `draw`, but they
           are not the same thing to confirm. A host rearranging who plays who is asking about the
           pairings that come out the other side, so quote them from the bracket the swap would
           actually build rather than making them picture it. */
        const nextBracket=buildBracket<Match>(precheck.tournament,data.matches);
        const opponentAfter=(id:string)=>{
          const slot=nextBracket.slots.find(item=>item.round===1&&(item.a===id||item.b===id));
          const other=slot?opponentIn(slot,id):"";
          return other?playerName(other):t("輪空");
        };
        if(precheck.kind==="swap")askConfirm({kicker:t("調整對陣"),title:t("對調「{v}」同「{v2}」喺「{name}」籤表嘅位置？", {v: playerName(outgoingId), v2: playerName(incomingId), name: tournament.name}),description:t("對調後：{v} 對 {v2}、{v3} 對 {v4}。其他對陣維持不變，受影響的球員會收到通知。", {v: playerName(outgoingId), v2: opponentAfter(outgoingId), v3: playerName(incomingId), v4: opponentAfter(incomingId)}),confirmLabel:t("確定對調"),onConfirm:()=>submitRedraw(tournament,{action:"swap",outgoingId,incomingId},t("已調整對陣。"))});
        else askConfirm({kicker:t("更換參賽球員"),title:t("在「{name}」籤表中以「{v}」代替「{v2}」？", {name: tournament.name, v: playerName(incomingId), v2: playerName(outgoingId)}),description:t("{v} 將對 {v2}。其他對陣維持不變，受影響的球員會收到通知。", {v: playerName(incomingId), v2: opponentAfter(incomingId)}),confirmLabel:t("確定更換"),onConfirm:()=>submitRedraw(tournament,{action:"swap",outgoingId,incomingId},message)});
      }else{
        if(tournament.signups.includes(incomingId)){setToast(t("該球員已在名單內。"));return}
        const text=t("更換參賽球員：{name} — {v} → {v2}", {name: tournament.name, v: playerName(outgoingId), v2: playerName(incomingId)});
        const updated:Tournament={...tournament,signups:tournament.signups.map(id=>id===outgoingId?incomingId:id)};
        askConfirm({kicker:t("更換參賽球員"),title:t("在「{name}」報名名單中以「{v}」代替「{v2}」？", {name: tournament.name, v: playerName(incomingId), v2: playerName(outgoingId)}),description:t("名單會即時更新。"),confirmLabel:t("確定更換"),onConfirm:()=>apply(updated,text,message)});
      }
    }else if(incomingId){
      if(drawn){
        const precheck=addEntrant(t, tournament,incomingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        askConfirm({kicker:t("加入參賽球員"),title:t("將「{v}」加入「{name}」籤表？", {v: playerName(incomingId), name: tournament.name}),description:t("籤表會重新排列，對陣有變的球員會收到通知。"),confirmLabel:t("確定加入"),onConfirm:()=>submitRedraw(tournament,{action:"add",playerId:incomingId},t("已加入參賽球員。"))});
        return;
      }
      if(tournament.signups.includes(incomingId)){setToast(t("該球員已在名單內。"));return}
      const updated:Tournament={...tournament,signups:[...tournament.signups,incomingId]};
      apply(updated,t("加入報名：{name} — {v}", {name: tournament.name, v: playerName(incomingId)}),t("已加入報名名單。"));
    }else if(outgoingId){
      if(drawn){
        const precheck=removeEntrant(t, tournament,outgoingId,data.matches);
        if(!precheck.ok){setToast(precheck.error);return}
        askConfirm({kicker:t("移除參賽球員"),title:t("將「{v}」移出「{name}」籤表？", {v: playerName(outgoingId), name: tournament.name}),description:t("籤表會重新排列，對陣有變的球員會收到通知。"),confirmLabel:t("確定移除"),onConfirm:()=>submitRedraw(tournament,{action:"remove",playerId:outgoingId},t("已移除參賽球員。"))});
        return;
      }
      askConfirm({kicker:t("移除報名"),title:t("將「{v}」移出「{name}」報名名單？", {v: playerName(outgoingId), name: tournament.name}),description:t("移除後可重新加入。"),confirmLabel:t("確定移除"),onConfirm:()=>{
        const updated:Tournament={...tournament,signups:tournament.signups.filter(id=>id!==outgoingId)};
        apply(updated,t("移除報名：{name} — {v}", {name: tournament.name, v: playerName(outgoingId)}),t("已移除報名。"));
      }});
    }
  }

  /* A draw an admin doesn't like — a lopsided pairing, a rivalry landing in round one — has one
     remedy from the moment sign-ups close up to the moment somebody actually plays: re-roll it.
     `shuffleDraw` refuses before the deadline (freezing early would strand later sign-ups outside
     the bracket) and once any tie in the cup has a recorded result. */
  function shuffleTournamentRoster(tournament:Tournament){
    if(!canManageCup(tournament)){setToast(t("只有盃賽主持人或協辦主持人可以重新抽籤。"));return;}
    // Cheap client-side pre-check only, so an admin who has just recorded a
    // result gets an immediate "已有賽果" toast instead of a round trip — the
    // write and the notifications to affected entrants still happen server-side.
    const precheck=shuffleDraw(t, tournament,data.matches);
    if(!precheck.ok){setToast(precheck.error);return}
    askConfirm({kicker:t("重新抽籤"),title:t("重新抽籤「{name}」？", {name: tournament.name}),description:t("會產生新的對陣，受影響的球員會收到通知。"),confirmLabel:t("確定重新抽籤"),onConfirm:()=>submitRedraw(tournament,{action:"shuffle"},t("已重新抽籤。"))});
  }

  /* Dragging one name onto another is the same lever as the reshuffle button before a result, or a
     presentation-only roster edit after the cup is complete. No confirmation dialog: a drop is
     already the deliberate act a confirm would be asking about, and it is silently reversible by
     dragging again. A partially played cup stays locked until it is complete. */
  function reorderTournamentRoster(tournament:Tournament,draggedId:string,targetId:string){
    if(!canManageCup(tournament))return;
    const precheck=reorderDraw(t, tournament,draggedId,targetId,data.matches);
    if(!precheck.ok){setToast(precheck.error);return}
    const completed=Boolean(buildBracket<Match>(tournament,data.matches).champion);
    submitRedraw(tournament,{action:"reorder",draggedId,targetId},completed?t("已調整參賽名單順序。"):t("已調整籤表順序。"));
  }

  /* Signing up for a cup belongs to 比賽, not 約戰 — entering a competition and pitching a friendly
     are different jobs. Lifted out of the matchmaking tab's props so the cup bracket and the
     per-slot shortcut can both call the same thing. */
  const signUpTournament=async(tournamentId:string,arrivalTime?:string)=>{
        if(!ownPlayerId){setToast(t("請先登入會員帳戶，才可報名盃賽。"));return}
        const tournament=data.tournaments.find(item=>item.id===tournamentId),deadline=tournament?.signupDeadline?new Date(`${tournament.signupDeadline.length===10?tournament.signupDeadline+"T23:59":tournament.signupDeadline}:00+08:00`):null;
        if(deadline&&!Number.isNaN(deadline.getTime())&&deadline.getTime()<Date.now()){setToast(t("此盃賽報名已截止。"));return}
        const snapshot=data;
        const nextTournaments = data.tournaments.map(t=>{
          if(t.id!==tournamentId)return t;
          const joined=(t.signups||[]).includes(ownPlayerId);
          const arrivalTimes={...(t.arrivalTimes||{})};
          if(joined)delete arrivalTimes[ownPlayerId];
          else if(arrivalTime)arrivalTimes[ownPlayerId]=arrivalTime;
          return {...t,signups:joined?t.signups.filter(s=>s!==ownPlayerId):[...(t.signups||[]),ownPlayerId],arrivalTimes};
        });
        const next={...data,tournaments:nextTournaments,audits:[{id:crypto.randomUUID(),text:`${(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?t("報名"):t("取消報名")} 盃賽：${nextTournaments.find(t=>t.id===tournamentId)?.name}`,at:new Date().toISOString()},...data.audits]};
        setData(next);persist(next,(nextTournaments.find(t=>t.id===tournamentId)?.signups||[]).includes(ownPlayerId)?t("已報名盃賽。"):t("已取消報名盃賽。"),snapshot);
  };

  /* Arrival time is a courtesy for the other entrants, not a competition decision, so it never asks
     for confirmation the way joining/leaving does — set it, change it, clear it, any time after
     signing up. */
  const setTournamentArrivalTime=(tournamentId:string,arrivalTime:string)=>{
    if(!ownPlayerId)return;
    const snapshot=data;
    const nextTournaments=data.tournaments.map(t=>{
      if(t.id!==tournamentId)return t;
      const arrivalTimes={...(t.arrivalTimes||{})};
      if(arrivalTime)arrivalTimes[ownPlayerId]=arrivalTime; else delete arrivalTimes[ownPlayerId];
      return {...t,arrivalTimes};
    });
    const next={...data,tournaments:nextTournaments};
    setData(next);persist(next,arrivalTime?t("已更新到達時間。"):t("已清除到達時間。"),snapshot);
  };

  const navBadge=(id:string)=>id==="play"?playBadge:id==="matches"?openTournamentCount:0;
  /** What 約戰's badge counts, said for a screen reader. */
  const navBadgeLabel=(id:string)=>{
    if(id==="matches")return t("{openTournamentCount} 個盃賽開放報名", {openTournamentCount});
    if(id!=="play")return undefined;
    return t("{playBadge} 項待處理", {playBadge});
  };

  return <><style>{`.read-only .card-tools,.read-only .hero.small > .primary{display:none}`}</style><AppShell signedIn={Boolean(user)}>
    <div className={`pull-refresh${refreshing?" spinning":""}`} style={{height:refreshing?PULL_THRESHOLD:pullDistance,opacity:refreshing||pullDistance>0?1:0}} aria-hidden="true">
      <span/>
    </div>
    <DesktopNavigation active={tab as Destination} onNavigate={goTab} badge={navBadge} badgeLabel={navBadgeLabel} signedIn={Boolean(user)} needsOnboarding={Boolean(user?.needsOnboarding)}/>
    <main>
      <AppHeader user={user} loadStatus={stateLoadStatus} saving={saving} onSettings={()=>goTab("settings")}/>
      <PageFrame className={`app-page-${tab}`}>
      {user?.needsOnboarding&&<InlineNotice tone="warning" title={t("完成新會員設定")}>
        <span>{t("設定頭像並回答問題後，即可取得初始評級；完成前無法記錄比賽。")}</span>{" "}
        <a className="onboarding-notice-link" href="/onboarding?reminder=1">{t("立即完成")}</a>
      </InlineNotice>}
      {stateLoadStatus==="loading"&&<HomeLoadingSkeleton/>}
      {stateLoadStatus==="failed"&&<InlineNotice tone="danger" title={t("未能載入球會資料")}><span>{stateLoadError}</span> <Button variant="secondary" onClick={()=>{setStateLoadStatus("loading");setStateLoadError("");setStateRetry(value=>value+1)}}>{t("重試")}</Button></InlineNotice>}
      {stateLoadStatus==="ready"&&<>
      {/* The club's pulse, on the screen members actually open. Matchmaking used to live entirely
          behind a tab, so "is anyone playing tonight?" was unanswerable without going to look. */}
      {tab==="leaderboard"&&!user&&<GuestIntro onStartTour={()=>setTourOpen(true)}/>}
      {tab==="leaderboard"&&user&&ownPlayerId&&!user.needsOnboarding&&<FirstStepsChecklist hasMatch={data.matches.some(match=>match.a===ownPlayerId||match.b===ownPlayerId)} onRecord={()=>newMatch()} onTour={()=>setTourOpen(true)}/>}
      {tab==="leaderboard"&&<SquadAddedNotices squads={squads} players={data.players} onView={id=>{squadAction(id,"seen");selectSquad(id)}} onLeave={id=>squadAction(id,"leave")} onDismiss={id=>squadAction(id,"seen")}/>}
      {tab==="leaderboard"&&<Leaderboard onClubScope={()=>selectSquad(null)} ranked={ranked} data={data} ownPlayerId={ownPlayerId} squad={activeSquad} scope={{squads,onSelect:selectSquad,onMore:()=>setSquadSheet("browse"),onCreate:()=>setSquadSheet("create"),isAdmin:Boolean(isAdmin),onManage:()=>setSquadSheet("manage")}} onRecord={()=>newMatch()} onPlayer={(p)=>{setDetail(p);setModal("detail")}} onMatch={(match)=>{setHeadToHead({a:"",b:""});setHighlightMatch(match.id);setMatchesView("history");showTab("matches")}} onRivalry={(first,second)=>openHeadToHead(first,second)}/>}
      {tab==="matches"&&<Matches squad={activeSquad} scopeMenu={<SquadScopeMenu squad={activeSquad} squads={squads} onSelect={selectSquad} onSwitch={()=>setSquadSheet(squads.length?"picker":"browse")} onManage={()=>setSquadSheet("manage")}/>} data={data} canManageMatch={canManageMatch} canManageCup={canManageCup} onEdit={editMatch} onVoid={requestDeleteMatch} onShare={shareMatch} onPlayer={(player)=>{setDetail(player);setModal("detail")}} view={matchesView} setView={setMatchesView} pair={headToHead} setPair={setHeadToHead} highlight={highlightMatch} isAdmin={Boolean(isAdmin)} onCreateTournament={()=>{setEditingTournament(null);setCoHostSearch("");setTournamentForm({name:"",format:"single",handicapMode:"suggested",startAt:"",signupDeadline:`${today}T23:59`,coHosts:[]});setModal("tournament")}} onEditTournament={tournament=>{setEditingTournament(tournament);setCoHostSearch("");setTournamentForm({name:tournament.name,format:tournament.format??"single",handicapMode:tournament.handicapMode,startAt:tournament.startAt??"",signupDeadline:tournament.signupDeadline.length===10?`${tournament.signupDeadline}T23:59`:tournament.signupDeadline,coHosts:tournament.coHosts??[]});setModal("tournament")}} onDeleteTournament={deleteTournament} ownPlayerId={ownPlayerId} onSignUpTournament={signUpTournament} onSetArrivalTime={setTournamentArrivalTime} onRecordSlot={recordCupSlot} onArrange={arrangeCupMatch} onWalkover={declareWalkover} onEditRoster={editCupRoster} onShuffleRoster={shuffleTournamentRoster} onReorderRoster={reorderTournamentRoster} onRefresh={refreshData}/>}
      {tab==="play"&&<PlayBoard key={ownPlayerId??"guest"} ownPlayerId={ownPlayerId} players={data.players.filter(p=>p.active).map(p=>({id:p.id,name:p.name,rating:p.rating}))} matches={data.matches} settings={data.settings} focusSessionId={playFocus} onFocusConsumed={()=>setPlayFocus(null)} target={playTarget} onTargetConsumed={()=>setPlayTarget(null)} onActivity={refreshPlay} onResultRecorded={()=>void refreshData()} onSignIn={()=>setModal("signIn")}/>}
      {tab==="players"&&<Players data={data} ownPlayerId={ownPlayerId} managementMode={Boolean(isAdmin&&managementMode)} canAdd={Boolean(isAdmin)} canManagePlayer={player=>Boolean(isAdmin||player.id===ownPlayerId)} onAdd={()=>{if(!isAdmin){setToast(t("只有管理員可以新增球員。"));return;}setEditingPlayer(null);setPlayerForm({name:"",short:"",handicap:"",rating:"",colour:DEFAULT_AVATAR});setModal("player")}} onEdit={editPlayer} onDelete={deletePlayer} onOpen={(p)=>{setDetail(p);setModal("detail")}} onCompare={(p)=>openHeadToHead(p,data.players.find(candidate=>candidate.id===ownPlayerId))} onRecordAgainst={(p)=>newMatch("1v1",p.id)} onFindOpponent={jumpToPlayerAvailability}/>}
      {tab==="settings"&&isAdmin&&<SettingsView data={data} onEdit={()=>isAdmin?setModal("settings"):setToast(t("只有管理員可以修改 ELO 設定。"))} onReset={resetAll} canReset={user?.role==="admin"}/>}
      </>}
      </PageFrame>
    </main>
    {/* Outside <main>: the shell sizes every direct child of main to the content column. */}
    {tourOpen&&stateLoadStatus==="ready"&&<IntroTour tab={tab} signedIn={Boolean(user)} onShow={goTab} onClose={closeTour}/>}
    {/* Record sits dead centre as the one thing this app exists to do; the four content tabs split
        evenly around it. 設定 is not a peer of them — it lives with the account controls instead. */}
    {recordMenuOpen&&<button type="button" className="record-menu-scrim" aria-label={t("關閉比賽模式選單")} onClick={()=>setRecordMenuOpen(false)}/>}
    <div className={`record-speed-dial${recordMenuOpen?" open":""}`} aria-hidden={!recordMenuOpen}>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("1v1")}><i>1v1</i><span><b>{t("正式 1v1")}</b><small>{t("賽果會改變實際 ELO 與球員統計")}</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("2v2")}><i>2v2</i><span><b>{t("潮拍 2v2")}</b><small>{t("純娛樂模式，不影響目前 ELO 與統計")}</small></span></button>
      <button type="button" tabIndex={recordMenuOpen?0:-1} onClick={()=>newMatch("cup")}><i>{t("盃賽")}</i><span><b>{t("盃賽記錄")}</b><small>{t("選擇盃賽場次並儲存，不可手動設定讓分")}</small></span></button>
    </div>
    <MobileBottomNav active={tab as Destination} onNavigate={goTab} onRecord={()=>setRecordMenuOpen(open=>!open)} recordOpen={recordMenuOpen} badge={navBadge} badgeLabel={navBadgeLabel}/>
    {/* Share is the first modal kind migrated off this shared shell onto the `Sheet`
        primitive (see docs/ui-audit.md §3) — it owns its own scrim, safe-area handling,
        and close button now, so it is excluded from the block below and rendered
        separately underneath it. */}
    <Sheet open={modal==="share"} title={sharePayload?shareSheetTitle(t, sharePayload.card.kind):""} onClose={closeModal}>
      {sharePayload&&<ShareSheet card={sharePayload.card} message={sharePayload.message} url={sharePayload.url} title={sharePayload.title} heading={false}/>}
    </Sheet>
    {modal&&modal!=="share"&&<OverlayBackdrop onClose={closeModal}>
      {/* `.close` is a sibling of `.sheet`, not a child: `.sheet` is the scrolling box, and a
          descendant can never sit outside it or straddle its edge without being clipped by that
          same overflow. As a sibling inside `.sheet-shell` it floats above the corner, stays put
          while the sheet content scrolls underneath it, and can cross the sheet's edge freely. */}
      <div className={`sheet-shell${modal==="detail"?" player-detail-sheet":""}${modal==="match"?" match-entry-sheet":""}`}>
        <IconButton className="close" label={t("關閉")} onClick={closeModal}>×</IconButton>
        <section className={`sheet${modal==="deleteMatch"?" confirm-sheet":""}`} role="dialog" aria-modal="true">
          {modal==="match"&&<MatchForm ownPlayerId={ownPlayerId} squads={squads} data={data} draft={draft} setDraft={setDraft} preview={preview} a={a} b={b} editing={!!editingMatch} saving={saving} onSave={saveMatch}/>}
          {modal==="tournament"&&<div>
            <p className="kicker">{t("盃賽")}</p>
            <h2>{editingTournament?t("編輯盃賽"):t("建立新盃賽")}</h2>
            <p className="sub">{t("建立盃賽以便球員報名與賽事管理。")}</p>
            <form className="tournament-form" onSubmit={ev=>{ev.preventDefault();
              if(!tournamentForm.name.trim()){setToast(t("請輸入盃賽名稱。"));return}
              if(!tournamentForm.startAt){setToast(t("請輸入盃賽開始日期及時間。"));return}
              const id=editingTournament?.id??crypto.randomUUID();
              const now=new Date().toISOString();
              /* Pushing the deadline back into the future is how an admin reopens sign-ups, and a
                 draw made against the old roster cannot survive that: it would pair people who are
                 no longer the field. Clearing it here lets the freeze happen again, once, when the
                 new deadline passes. Recorded results are left alone — deleting them is the ✕. */
              const reopening=Boolean(editingTournament?.draw?.length)&&!signupsClosed({signupDeadline:tournamentForm.signupDeadline});
              const commit=()=>{
                const tournament: Tournament = {id,name:tournamentForm.name.trim(),format:tournamentForm.format,handicapMode:tournamentForm.handicapMode,startAt:tournamentForm.startAt,signupDeadline:tournamentForm.signupDeadline,createdAt:editingTournament?.createdAt??now,createdBy:editingTournament?.createdBy??ownPlayerId,coHosts:editingTournament?(canManageCupHosts(editingTournament)?tournamentForm.coHosts:editingTournament.coHosts??[]):tournamentForm.coHosts,signups:editingTournament?.signups??[],
                  draw:reopening?undefined:editingTournament?.draw,drawnAt:reopening?undefined:editingTournament?.drawnAt,rosterOrder:reopening?undefined:editingTournament?.rosterOrder,walkovers:reopening?undefined:editingTournament?.walkovers,arrivalTimes:editingTournament?.arrivalTimes};
                const tournaments = editingTournament? data.tournaments.map(t=>t.id===id?tournament:t) : [tournament,...data.tournaments];
                const next={...data,tournaments,audits:[{id:crypto.randomUUID(),text:`${editingTournament?t("更新"):t("建立")} 盃賽：${tournament.name}`,at:now},...data.audits]};
                setEditingTournament(null);setModal(null);setToast(editingTournament?t("盃賽已更新。"):t("盃賽已建立。"));setData(next);persist(next,editingTournament?t("盃賽已更新。"):t("盃賽已建立。"),data);
              };
              if(reopening)askConfirm({kicker:t("重新開放報名"),title:t("「{v}」已經抽籤", {v: tournamentForm.name.trim()}),description:t("重新開放報名會清除現有籤表，截止後重新抽籤（已記錄的賽果會保留）。繼續？"),confirmLabel:t("重新開放"),onConfirm:commit});
              else commit();
            }}>
              <label>{t("盃賽名稱")}<input type="text" value={tournamentForm.name} onChange={e=>setTournamentForm({...tournamentForm,name:e.target.value})} required/></label>
              <label>{t("賽制")}<select value={tournamentForm.format} onChange={e=>setTournamentForm({...tournamentForm,format:e.target.value as "single"|"double"})}>
                <option value="single">{t("單敗淘汰（現有賽制）")}</option>
                <option value="double">{t("雙敗淘汰（勝者組 + 敗者組 + 總決賽）")}</option>
              </select></label>
              {tournamentForm.format==="double"&&<p className="mm-note">{t("雙敗淘汰：每位球員先進入勝者組，輸一場會轉到敗者組；敗者組再輸一場才會被淘汰，最後勝者組冠軍對敗者組冠軍決定總冠軍。")}</p>}
              <label>{t("讓分模式")}<select value={tournamentForm.handicapMode} onChange={e=>setTournamentForm({...tournamentForm,handicapMode:e.target.value as "suggested"|"none"})}><option value="suggested">{t("建議讓分（系統會自動套用建議）")}</option><option value="none">{t("不設讓分")}</option></select></label>
              <label>{t("盃賽開始日期及時間")}<input type="datetime-local" value={tournamentForm.startAt} onChange={e=>setTournamentForm({...tournamentForm,startAt:e.target.value})} required/></label>
              <label>{t("報名截止日期及時間")}<input type="datetime-local" value={tournamentForm.signupDeadline} onChange={e=>setTournamentForm({...tournamentForm,signupDeadline:e.target.value})} required/></label>
              {(()=>{
                const canEditCoHosts=editingTournament?canManageCupHosts(editingTournament):Boolean(isAdmin||ownPlayerId);
                const tournamentOwnerId=editingTournament?.createdBy??ownPlayerId;
                const selectedPlayers=tournamentForm.coHosts.map(id=>data.players.find(player=>player.id===id)).filter((player):player is Player=>Boolean(player));
                const query=coHostSearch.trim().toLocaleLowerCase();
                const candidates=data.players.filter(player=>player.active&&player.id!==tournamentOwnerId&&(!query||player.name.toLocaleLowerCase().includes(query)));
                return <div className={`tournament-cohosts${canEditCoHosts?"":" is-readonly"}`} role="group" aria-labelledby="tournament-cohosts-title">
                  <div className="tournament-cohosts-head"><div><span className="tournament-cohosts-eyebrow">{t("管理權限")}</span><h3 id="tournament-cohosts-title">{t("協辦主持人")}</h3></div><span className="tournament-cohosts-count">{t("{coHosts} 位", {coHosts: tournamentForm.coHosts.length})}</span></div>
                  <p className="tournament-cohosts-intro">{t("選擇可以協助編輯盃賽、調整籤表及管理名單的球員。")}</p>
                  {selectedPlayers.length>0&&<div className="tournament-cohosts-selected" aria-label={t("已選擇的協辦主持人")}>{selectedPlayers.map(player=><button type="button" className="tournament-cohost-chip" key={player.id} disabled={!canEditCoHosts} onClick={()=>setTournamentForm(current=>({...current,coHosts:current.coHosts.filter(id=>id!==player.id)}))}><PlayerBadge player={player}/><span>{player.name}</span><b aria-hidden="true">×</b></button>)}</div>}
                  <label className="tournament-cohosts-search"><span aria-hidden="true">⌕</span><input type="search" value={coHostSearch} disabled={!canEditCoHosts} onChange={event=>setCoHostSearch(event.target.value)} placeholder={t("搜尋球員")} aria-label={t("搜尋協辦主持人")}/></label>
                  <div className="tournament-cohosts-results" aria-label={t("可選擇的協辦主持人")}>{candidates.length>0?candidates.map(player=>{const selected=tournamentForm.coHosts.includes(player.id);return <button type="button" className={`tournament-cohost-option${selected?" is-selected":""}`} key={player.id} disabled={!canEditCoHosts} onClick={()=>setTournamentForm(current=>({...current,coHosts:selected?current.coHosts.filter(id=>id!==player.id):[...new Set([...current.coHosts,player.id])]}))}><PlayerBadge player={player}/><span>{player.name}</span><b>{selected?t("已加入"):t("加入")}</b></button>}):<p className="tournament-cohosts-empty">{t("沒有符合的球員")}</p>}</div>
                  <small>{canEditCoHosts?t("協辦主持人可以編輯此盃賽、調整籤表及管理名單。"):t("只有盃賽主持人可以更改協辦主持人。")}</small>
                </div>;
              })()}
              {Boolean(editingTournament?.draw?.length)&&<p className="mm-note">{t("此盃賽已抽籤（{draw} 人）。將截止時間改到未來即可重新開放報名，並在新截止時間後重新抽籤。", {draw: editingTournament?.draw?.length})}</p>}
              <div className="sheet-actions"><Button type="submit">{t("儲存盃賽")}</Button><Button variant="secondary" type="button" onClick={()=>{setModal(null);setEditingTournament(null)}}>{t("取消")}</Button></div>
            </form>
          </div>}
          {modal==="player"&&<PlayerForm form={playerForm} setForm={setPlayerForm} editing={!!editingPlayer} canEditRating={isAdmin} onSave={savePlayer}/>}
          {modal==="settings"&&<SettingsForm data={data} onSave={(settings)=>{const start=Number(settings.start ?? data.settings.start ?? 1500); const applied={...settings,start,handicapPointsToElo:HANDICAP_ELO_PER_POINT,handicapEffectiveness:1,modelVersion:HANDICAP_MODEL_VERSION}; const rebuilt=replay(data.players.map(player=>({...player,initialRating:start,rating:start})),data.matches,applied); setModal(null); persist({...data,settings:applied,...rebuilt,audits:[{id:crypto.randomUUID(),text:`調整 Snooker Elo 公式參數；以 ${start} 起始並重播歷史評分`,at:new Date().toISOString()},...data.audits]},t("設定已套用，歷史評分已從 {start} 重播。", {start}))}}/>}
          {modal==="deleteMatch"&&deletingMatch&&<ConfirmDeleteMatch match={deletingMatch} data={data} onCancel={closeModal} onConfirm={confirmDeleteMatch}/>}
          {modal==="signIn"&&<><p className="kicker">{t("會員功能")}</p><h2>{t("先登入或建立帳戶")}</h2><p className="sub">{t("記錄賽果前，請登入會員帳戶；新會員註冊時會同時建立球員檔案。")}</p><div className="auth-buttons"><a className="primary" href="/login">{t("登入")}</a><a className="more" href="/login?mode=signup">{t("建立帳戶")}</a></div></>}
          {modal==="detail"&&detail&&<PlayerDetail player={detail} rank={ranked.findIndex(p=>p.id===detail.id)+1} data={data} onCompare={opponent=>{setModal(null);openHeadToHead(detail,opponent)}} onViewAllMatches={()=>{setModal(null);openPlayerMatches(detail)}} onMatch={matchId=>{setModal(null);setHeadToHead({a:detail.id,b:""});setHighlightMatch(matchId);setMatchesView("history");showTab("matches")}} onFindOpponent={jumpToPlayerAvailability} onShare={()=>sharePlayer(detail)}/>}
        </section>
      </div>
    </OverlayBackdrop>}
    {pendingConfirm&&<ConfirmDialog kicker={pendingConfirm.kicker} titleId="pending-confirm-title" title={pendingConfirm.title} description={pendingConfirm.description} onClose={()=>setPendingConfirm(null)}><Button variant="secondary" onClick={()=>setPendingConfirm(null)}>{t("取消")}</Button><Button variant="danger" onClick={()=>{const run=pendingConfirm.onConfirm;setPendingConfirm(null);run()}}>{pendingConfirm.confirmLabel}</Button></ConfirmDialog>}
    <SquadCenter sheet={squadSheet} setSheet={setSquadSheet} squads={squads} loaded={squadsLoaded||!ownPlayerId} refresh={refreshSquads} selectedId={squadId} onSelect={selectSquad} viewing={publicSquad}
      players={data.players} ownPlayerId={ownPlayerId} signedIn={Boolean(user)} isAdmin={Boolean(isAdmin)} notify={name=>setToast(t("已加入「{squad}」", {squad:name}))}/>
    {toast&&<div className={`toast${undoSnapshot?" toast-expiring":""}`} role="status"><span>{toast}</span>{undoSnapshot&&<Button variant="quiet" onClick={undoDelete}>{t("復原")}</Button>}</div>}
    {regularPrompt&&<div className="regular-prompt" role="status">
      <b>{t("你哋第一次對戰")}</b>
      <span>{t("加 {name} 做常打對手？之後佢開局會標「打過」，佢唔會收到通知，你隨時可以喺約戰板移除。", {name: regularPrompt.name})}</span>
      <div>
        <Button variant="primary" onClick={addRegularNow}>{t("加為常打對手")}</Button>
        <Button variant="quiet" onClick={()=>setRegularPrompt(null)}>{t("而家唔使")}</Button>
      </div>
    </div>}
  </AppShell></>;
}
