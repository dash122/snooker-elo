import { getSql } from "./sql";
import { addDaysHongKong, hkDate } from "../lib/availability";
import { forecastNight, isConfidence, nightWindow, normaliseQuorum, promotionsFor,
  type AttendanceSignal, type Calibration, type Confidence, type NightForecast } from "../lib/nights";

/* --- 場次 · the data side --------------------------------------------------
 *
 * Two ideas do all the work here, and both are about not asking members for anything.
 *
 * A night is **materialised lazily**. Nobody opens an evening; it comes into existence the first
 * time somebody signals for it. Pre-generating rows for every date would cost thousands of empty
 * records to answer a question the forecast can already answer from nothing, and once venues arrive
 * that cost multiplies by every club in Hong Kong.
 *
 * The promotion engine runs **inside the write transaction**, not on a schedule. 夠人就去 has to
 * resolve the moment the floor moves, because its whole value is telling somebody 「夠人喇」 while
 * they can still act on it. Doing it in the same transaction as the signal that caused it also
 * makes it naturally idempotent: two members tapping at once serialise, and the second sees the
 * first's promotion already applied.
 *
 * Schema changes are migration-owned — see supabase/migrations/20260830000000_nights_attendance.sql.
 * Nothing here issues DDL: even idempotent CREATE/ALTER statements take heavyweight relation locks,
 * and running them on serverless cold starts is what used to stall unrelated reads until
 * lock_timeout. */

export type NightRow = { id:string; date:string; startAt:string; endAt:string };
export type AttendanceRow = AttendanceSignal & { promotedAt:string|null };
export type NightPlayer = { id:string; name:string; short:string|null; rating:number; colour:string|null; avatar:string|null };

export type NightBoard = {
  date:string;
  startAt:string;
  endAt:string;
  forecast:NightForecast;
  /** Only 一定去 is named. A hedge is counted and never attributed, which is the entire reason it
      stays cheap enough for somebody to leave one. */
  confirmed:NightPlayer[];
  /** This viewer's own row, which they are always allowed to see in full. */
  mine:{ confidence:Confidence; upgradeAt:number|null; promoted:boolean }|null;
};

const nightId=(date:string)=>`night-${date}`;

/** Turn a date into its night row, creating it if this is the first signal for that evening.
 *  `ON CONFLICT DO NOTHING` rather than a read-then-write: two members signalling for a fresh date
 *  at the same moment would otherwise race, and one of them would get a foreign-key violation. */
async function ensureNight(date:string):Promise<NightRow>{
  const sql=getSql();
  const { startAt, endAt }=nightWindow(date);
  const rows=await sql<NightRow[]>`
    WITH inserted AS (
      INSERT INTO nights (id,night_date,start_at,end_at)
      VALUES (${nightId(date)},${date}::date,${startAt}::timestamptz,${endAt}::timestamptz)
      ON CONFLICT (night_date) DO NOTHING
      RETURNING id, to_char(night_date,'YYYY-MM-DD') AS date, start_at AS "startAt", end_at AS "endAt"
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT id, to_char(night_date,'YYYY-MM-DD') AS date, start_at AS "startAt", end_at AS "endAt"
      FROM nights WHERE night_date=${date}::date
    LIMIT 1`;
  return rows[0];
}

/* --- Calibration -----------------------------------------------------------
 *
 * How often a member actually turns up, per level, from their own history. Derived rather than
 * stored: it is a rolling six-month aggregate over rows we already have, and a stored copy would
 * only add a way for it to go stale.
 *
 * Ground truth for "turned up" is a match recorded on that date. That under-counts the member who
 * came, watched, and went home without playing — but it over-counts nobody, and a forecast that
 * errs low is the safe direction. A member who reads 「2 人確定」 and finds four is delighted; the
 * reverse loses them permanently.
 *
 * Returns nothing at all when the club has no history, which is the correct state on day one: the
 * pure layer falls back to club priors and the forecast is honest about being a prior. */
export async function calibrationByPlayer():Promise<Record<string,Calibration>>{
  const sql=getSql();
  const rows=await sql<{playerId:string;level:Confidence;total:number;showed:number}[]>`
    SELECT a.player_id AS "playerId", a.confidence AS level,
      count(*)::int AS total,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM state_matches m
        WHERE m.played_on = n.night_date AND m.status='confirmed'
          AND a.player_id IN (m.player_a,m.player_b,m.player_a2,m.player_b2)
      ))::int AS showed
    FROM night_attendance a
    JOIN nights n ON n.id=a.night_id
    WHERE a.confidence <> 'out'
      AND n.night_date > (now() - interval '180 days')::date
      AND n.night_date < (now() AT TIME ZONE 'Asia/Hong_Kong')::date
    GROUP BY a.player_id, a.confidence`;

  const out:Record<string,Calibration>={};
  for(const row of rows){
    const entry=out[row.playerId]??={sampleN:0};
    entry.sampleN+=row.total;
    if(row.level==="high"||row.level==="mid"||row.level==="low"){
      entry[row.level]=row.total>0?row.showed/row.total:null;
    }
  }
  return out;
}

async function signalsForNights(nightIds:string[]):Promise<Record<string,AttendanceRow[]>>{
  if(!nightIds.length)return {};
  const sql=getSql();
  const rows=await sql<{nightId:string;playerId:string;confidence:Confidence;upgradeAt:number|null;setAt:string;promotedAt:string|null}[]>`
    SELECT night_id AS "nightId", player_id AS "playerId", confidence,
           upgrade_at AS "upgradeAt", set_at AS "setAt", promoted_at AS "promotedAt"
      FROM night_attendance WHERE night_id IN ${sql(nightIds)}`;
  const grouped:Record<string,AttendanceRow[]>={};
  for(const row of rows)(grouped[row.nightId]??=[]).push(row);
  return grouped;
}

async function playersByIds(ids:string[]):Promise<Record<string,NightPlayer>>{
  if(!ids.length)return {};
  const sql=getSql();
  const rows=await sql<NightPlayer[]>`
    SELECT id, name, short, rating::float8 AS rating, colour, avatar
      FROM state_players WHERE id IN ${sql(ids)}`;
  return Object.fromEntries(rows.map(row=>[row.id,row]));
}

/** The board: the next `days` evenings, each with its forecast and its named commitments.
 *
 *  Nights with no signals at all are still returned. That is deliberate — a member planning ahead
 *  needs to see that Thursday is empty as much as that Wednesday is full, and an evening missing
 *  from the list reads as an error rather than as silence. */
export async function nightBoard(days:number,viewerId:string|null):Promise<NightBoard[]|null>{
  try{ return await readNightBoard(days,viewerId) }
  catch(error){ if(isMissingSchema(error))return null; throw error }
}

async function readNightBoard(days:number,viewerId:string|null):Promise<NightBoard[]>{
  const today=hkDate();
  const dates=Array.from({length:Math.max(1,Math.min(14,days))},(_,index)=>addDaysHongKong(today,index));
  const sql=getSql();

  const existing=await sql<NightRow[]>`
    SELECT id, to_char(night_date,'YYYY-MM-DD') AS date, start_at AS "startAt", end_at AS "endAt"
      FROM nights WHERE night_date = ANY(${dates}::date[])`;
  const byDate=Object.fromEntries(existing.map(row=>[row.date,row]));

  const [signals,calibrations]=await Promise.all([
    signalsForNights(existing.map(row=>row.id)),
    calibrationByPlayer(),
  ]);

  const namesNeeded=new Set<string>();
  for(const rows of Object.values(signals)){
    for(const row of rows)if(row.confidence==="high")namesNeeded.add(row.playerId);
  }
  /* Promotions have to be resolved before we know who to name — a member the club promoted is
     confirmed, and reading the board must show the same floor the writer computed. */
  for(const [id,rows] of Object.entries(signals)){
    void id;
    for(const playerId of promotionsFor(rows))namesNeeded.add(playerId);
  }
  const players=await playersByIds([...namesNeeded]);

  return dates.map(date=>{
    const night=byDate[date];
    const rows=night?signals[night.id]??[]:[];
    const window=night?{startAt:night.startAt,endAt:night.endAt}:nightWindow(date);
    const forecast=forecastNight({signals:rows,calibrations,nightStart:window.startAt});
    const confirmedIds=rows
      .filter(row=>row.confidence==="high"||forecast.promoted.includes(row.playerId))
      .map(row=>row.playerId);
    const mineRow=viewerId?rows.find(row=>row.playerId===viewerId):undefined;
    return {
      date,
      startAt:new Date(window.startAt).toISOString(),
      endAt:new Date(window.endAt).toISOString(),
      forecast,
      confirmed:confirmedIds.map(id=>players[id]).filter(Boolean),
      mine:mineRow?{
        confidence:mineRow.confidence,
        upgradeAt:mineRow.upgradeAt??null,
        promoted:forecast.promoted.includes(mineRow.playerId),
      }:null,
    };
  });
}

/* --- Before the migration has run -----------------------------------------
 *
 * The code ships ahead of the schema: a deploy carrying this file reaches production some time
 * before its migration reaches the database. That window is not an edge case to shrug at — it is
 * the normal order of events here.
 *
 * A missing table is therefore reported as "this feature is not provisioned", not as an error and
 * not as an empty night. The distinction matters. An error card parks a red banner at the top of a
 * tab that otherwise works perfectly, and an empty board is worse still — 「暫時未有人回覆」 is a
 * lie when the truth is that nobody was ever able to answer. Absent is the only honest state, so
 * the section renders nothing at all until the table exists. */
const UNDEFINED_TABLE = "42P01";

export function isMissingSchema(error:unknown):boolean{
  return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===UNDEFINED_TABLE);
}

export type SignalResult = { board:NightBoard; promoted:string[] };

/** Record one member's confidence for one night, and resolve every threshold it satisfies.
 *
 *  The promotion pass is the reason this is a transaction rather than an upsert. Writing a signal
 *  can raise the floor, which can satisfy somebody else's 夠人就去, which raises it again — and
 *  that cascade is the whole mechanic: three members who would each not have come alone all come,
 *  because each one's participation was conditional and something outside the group resolved the
 *  condition for them.
 *
 *  Promotion is one-way. Withdrawing later does not demote anybody who has already been told
 *  「夠人喇」, because by then they may have left the house. Un-promoting them would make the app a
 *  liar in the one situation where being wrong actually costs somebody an evening. */
export async function setAttendance(input:{
  playerId:string; date:string; confidence:unknown; upgradeAt?:unknown;
}):Promise<{promoted:string[]}>{
  if(!isConfidence(input.confidence))throw new Error("唔認得呢個選擇");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new Error("日期格式唔啱");
  if(input.date<hkDate())throw new Error("唔可以改過咗嘅日子");

  const confidence=input.confidence;
  /* 唔得 and a threshold contradict each other: one says "not tonight", the other says "unless
     enough people come". Keeping both would let other members' taps quietly reverse a decline. */
  const upgradeAt=confidence==="out"?null:normaliseQuorum(input.upgradeAt);
  const night=await ensureNight(input.date);
  const sql=getSql();

  return sql.begin(async tx=>{
    await tx`
      INSERT INTO night_attendance (night_id,player_id,confidence,upgrade_at,set_at,updated_at)
      VALUES (${night.id},${input.playerId},${confidence},${upgradeAt},now(),now())
      ON CONFLICT (night_id,player_id) DO UPDATE
        SET confidence=EXCLUDED.confidence, upgrade_at=EXCLUDED.upgrade_at,
            set_at=now(), updated_at=now()`;

    /* Locked for the promotion pass so two concurrent taps cannot both read the same floor and
       promote the same person twice, or promote two people into one seat's worth of quorum. */
    const rows=await tx<AttendanceRow[]>`
      SELECT player_id AS "playerId", confidence, upgrade_at AS "upgradeAt",
             set_at AS "setAt", promoted_at AS "promotedAt"
        FROM night_attendance WHERE night_id=${night.id} FOR UPDATE`;

    const promoted=promotionsFor(rows).filter(id=>{
      const row=rows.find(candidate=>candidate.playerId===id);
      return row&&!row.promotedAt;
    });
    if(promoted.length){
      await tx`
        UPDATE night_attendance SET confidence='high', promoted_at=now(), updated_at=now()
         WHERE night_id=${night.id} AND player_id IN ${tx(promoted)} AND promoted_at IS NULL`;
    }
    return {promoted};
  });
}

/** Clear a signal entirely — different from 唔得, which is an answer. This is "I never said". */
export async function clearAttendance(playerId:string,date:string):Promise<void>{
  const sql=getSql();
  await sql`
    DELETE FROM night_attendance a USING nights n
     WHERE a.night_id=n.id AND n.night_date=${date}::date AND a.player_id=${playerId}
       AND a.promoted_at IS NULL`;
}
