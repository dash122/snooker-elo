import { getSql } from "./sql";

/* --- 連續公開週數 -----------------------------------------------------------
 *
 * Computed on read rather than cached in a table of its own. The design brief called for a
 * `member_matchmaking_stats` cache, and it is the right shape once this is slow — but a cache has to
 * be invalidated on every publish, cancel, edit and recurrence expansion, and for a club of this
 * size the query below is a single indexed scan over one member's rows. Buying that invalidation
 * surface before there is a measurement to justify it would be paying maintenance for nothing.
 *
 * What counts as a published week is the definition agreed in review, and it is deliberately not
 * "posted anything": a week counts when the member published a slot of at least two hours whose
 * start was in the future at the time they wrote it. Streaks reward what they measure, and a looser
 * rule would reward keeping a number alive with slots nobody could play. */

/** Hong Kong weeks, so a Sunday-evening publish belongs to the week a member experienced it in. */
const WEEK_EXPR = `date_trunc('week', (start_at AT TIME ZONE 'Asia/Hong_Kong'))`;

export type PublishStreak = { weeks:number; publishedThisWeek:boolean };

export async function publishStreak(playerId:string):Promise<PublishStreak>{
  const sql=getSql();
  const rows=await sql<{week:string}[]>`
    SELECT DISTINCT ${sql.unsafe(WEEK_EXPR)}::date::text AS week
    FROM availability_slots
    WHERE player_id=${playerId}
      AND cancelled_at IS NULL
      AND end_at - start_at >= interval '2 hours'
      AND start_at > created_at
    ORDER BY week DESC
    LIMIT 60`;
  const weeks=rows.map(row=>row.week);
  if(!weeks.length)return {weeks:0,publishedThisWeek:false};

  const [{current}]=await sql<{current:string}[]>`
    SELECT date_trunc('week', (now() AT TIME ZONE 'Asia/Hong_Kong'))::date::text AS current`;

  /* A streak that includes this week and one that ended last week are both live: a member who has
     not published yet on Monday has not broken anything. Only a gap of two clear weeks ends it. */
  const publishedThisWeek=weeks[0]===current;
  const day=86400000;
  const startFrom=publishedThisWeek?0:1;
  if(!publishedThisWeek&&Date.parse(current)-Date.parse(weeks[0])>7*day)return {weeks:0,publishedThisWeek:false};

  let count=0;
  let expected=Date.parse(current)-startFrom*7*day;
  for(const week of weeks){
    if(Date.parse(week)!==expected)break;
    count+=1;
    expected-=7*day;
  }
  return {weeks:count,publishedThisWeek};
}

/** How many distinct members published a playable slot for this Hong Kong week. The club-wide figure
    behind 「本週已有 N 位球員公開時段」 — social proof has to be a real count or it is a lie the
    board tells every week. */
export async function clubPublishedThisWeek():Promise<number>{
  const sql=getSql();
  const [row]=await sql<{count:string}[]>`
    SELECT count(DISTINCT s.player_id)::text AS count
    FROM availability_slots s JOIN state_players p ON p.id=s.player_id
    WHERE s.cancelled_at IS NULL AND p.active=true
      AND ${sql.unsafe(WEEK_EXPR.replace(/start_at/g,"s.start_at"))}
          = date_trunc('week', (now() AT TIME ZONE 'Asia/Hong_Kong'))`;
  return Number(row?.count??0);
}

/** When this member joined, for the new-member grace period. `MemberSession` does not carry it and
    widening that type would touch every auth call site for one screen's benefit. */
export async function memberJoinedAt(email:string):Promise<string|null>{
  const sql=getSql();
  const [row]=await sql<{joinedAt:string}[]>`SELECT joined_at AS "joinedAt" FROM members WHERE email=${email.toLowerCase()}`;
  return row?.joinedAt?new Date(row.joinedAt).toISOString():null;
}
