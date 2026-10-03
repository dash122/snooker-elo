import type { Sql as PgSql, TransactionSql } from "postgres";
import { getSql } from "./sql";
import { msg } from "../lib/i18n/translate.ts";
import {
  MAX_SQUAD_MEMBERS, MAX_SQUADS_PER_PLAYER, PUBLIC_LISTING_MIN_MEMBERS, SquadError,
  hostsWithout, leaveOutcome, newInviteCode, type SquadRole, type SquadVisibility,
} from "../lib/squads.ts";

/* 球隊 — a filtered view of the club leaderboard. Every read and write here is on behalf of a
   signed-in member (`actor`, their state player id); authorisation happens in this module, never
   in the client. A private squad a viewer is not in reads as "not found", never "forbidden", so its
   existence doesn't leak. See supabase/migrations/20260930000000_squads.sql. */

type Sql = PgSql;
type Tx = TransactionSql;

export type SquadMember = { playerId: string; role: SquadRole; joinedAt: string };
export type SquadSummary = {
  id: string; name: string; visibility: SquadVisibility; memberCount: number;
  /** The viewer's role, or null when they are browsing a public squad they are not in. */
  role: SquadRole | null;
};
export type SquadDetail = SquadSummary & {
  members: SquadMember[];
  /** Hosts only: the private invite code. */
  inviteCode: string | null;
};
export type MySquad = SquadDetail & {
  /** Set when someone else added the viewer and they haven't acknowledged it yet. */
  addedBy: string | null;
};

const newId = () => crypto.randomUUID();

async function hasActiveAccount(tx: Tx | Sql, playerId: string) {
  const [row] = await tx<{ ok: boolean }[]>`
    SELECT true AS ok FROM members WHERE state_player_id=${playerId} AND active=true LIMIT 1`;
  return Boolean(row);
}

async function squadCountFor(tx: Tx | Sql, playerId: string) {
  const [row] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM squad_members WHERE player_id=${playerId}`;
  return row.n;
}

/** Lock the squad row for the rest of the transaction and return its membership, so concurrent
    host changes can't leave a squad without a host or over its size cap. */
async function lockSquad(tx: Tx, squadId: string) {
  const [squad] = await tx<{ id: string; visibility: SquadVisibility; invite_code: string }[]>`
    SELECT id, visibility, invite_code FROM squads WHERE id=${squadId} FOR UPDATE`;
  if (!squad) throw new SquadError(msg("搵唔到呢個球隊。"), 404);
  const members = await tx<{ playerId: string; role: SquadRole }[]>`
    SELECT player_id AS "playerId", role FROM squad_members WHERE squad_id=${squadId}`;
  return { squad, members };
}

function requireHost(members: { playerId: string; role: SquadRole }[], actor: string) {
  const self = members.find(member => member.playerId === actor);
  if (!self) throw new SquadError(msg("搵唔到呢個球隊。"), 404);
  if (self.role !== "host") throw new SquadError(msg("只有隊長可以管理球隊。"), 403);
}

async function membersOf(sql: Sql, squadIds: string[]) {
  if (!squadIds.length) return new Map<string, SquadMember[]>();
  const rows = await sql<(SquadMember & { squadId: string })[]>`
    SELECT squad_id AS "squadId", player_id AS "playerId", role, joined_at AS "joinedAt"
    FROM squad_members WHERE squad_id IN ${sql(squadIds)}
    ORDER BY (role='host') DESC, joined_at`;
  const grouped = new Map<string, SquadMember[]>();
  for (const { squadId, ...member } of rows) {
    const list = grouped.get(squadId) ?? [];
    list.push({ ...member, joinedAt: new Date(member.joinedAt).toISOString() });
    grouped.set(squadId, list);
  }
  return grouped;
}

export async function listMySquads(actor: string): Promise<MySquad[]> {
  const sql = getSql();
  const rows = await sql<{ id: string; name: string; visibility: SquadVisibility; invite_code: string; role: SquadRole; added_by: string | null; seen_at: Date | null }[]>`
    SELECT s.id, s.name, s.visibility, s.invite_code, m.role, m.added_by, m.seen_at
    FROM squad_members m JOIN squads s ON s.id=m.squad_id
    WHERE m.player_id=${actor}
    ORDER BY s.name`;
  const members = await membersOf(sql, rows.map(row => row.id));
  return rows.map(row => {
    const list = members.get(row.id) ?? [];
    return {
      id: row.id, name: row.name, visibility: row.visibility, role: row.role,
      memberCount: list.length, members: list,
      inviteCode: row.role === "host" ? row.invite_code : null,
      addedBy: row.seen_at === null && row.added_by && row.added_by !== actor ? row.added_by : null,
    };
  });
}

/** A squad as `viewer` may see it: members see their own squads, anyone (signed in or not) sees public ones. */
export async function getSquad(viewer: string | null, squadId: string, asAdmin = false): Promise<SquadDetail | null> {
  const sql = getSql();
  const [row] = await sql<{ id: string; name: string; visibility: SquadVisibility; invite_code: string; role: SquadRole | null }[]>`
    SELECT s.id, s.name, s.visibility, s.invite_code, m.role
    FROM squads s LEFT JOIN squad_members m ON m.squad_id=s.id AND m.player_id=${viewer}
    WHERE s.id=${squadId}`;
  /* Admins may open any squad, read-only: `role` stays whatever their own membership is (usually null). */
  if (!row || (row.visibility === "private" && !row.role && !asAdmin)) return null;
  const members = (await membersOf(sql, [row.id])).get(row.id) ?? [];
  return {
    id: row.id, name: row.name, visibility: row.visibility, role: row.role,
    memberCount: members.length, members, inviteCode: row.role === "host" ? row.invite_code : null,
  };
}

/** What an invite link shows before joining: enough to decide, nothing about who is in it. */
export async function previewInvite(code: string): Promise<{ id: string; name: string; memberCount: number } | null> {
  const sql = getSql();
  const [row] = await sql<{ id: string; name: string; member_count: number }[]>`
    SELECT s.id, s.name, (SELECT count(*)::int FROM squad_members m WHERE m.squad_id=s.id) AS member_count
    FROM squads s WHERE s.invite_code=${code}`;
  return row ? { id: row.id, name: row.name, memberCount: row.member_count } : null;
}

/** The public directory, most relevant first: squads holding the most people the viewer has
    actually played (confirmed singles), then the largest. A squad of strangers is a weaker reason
    to join than one of familiar opponents. */
export async function browsePublicSquads(viewer: string | null, query: string, asAdmin = false): Promise<(SquadSummary & { playedWith: number })[]> {
  const sql = getSql();
  const pattern = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const rows = await sql<{ id: string; name: string; visibility: SquadVisibility; member_count: number; played_with: number }[]>`
    WITH opponents AS (
      SELECT player_b AS id FROM state_matches WHERE player_a=${viewer} AND status='confirmed' AND mode IS DISTINCT FROM '2v2'
      UNION
      SELECT player_a FROM state_matches WHERE player_b=${viewer} AND status='confirmed' AND mode IS DISTINCT FROM '2v2'
    )
    SELECT s.id, s.name, s.visibility, count(m.player_id)::int AS member_count,
      count(o.id)::int AS played_with
    FROM squads s
    JOIN squad_members m ON m.squad_id=s.id
    LEFT JOIN opponents o ON o.id=m.player_id
    WHERE (${asAdmin}::boolean OR s.visibility='public')
      AND s.name ILIKE ${pattern}
      AND (${asAdmin}::boolean OR NOT EXISTS (SELECT 1 FROM squad_members mine WHERE mine.squad_id=s.id AND mine.player_id=${viewer}))
    GROUP BY s.id, s.name, s.visibility
    HAVING ${asAdmin}::boolean OR count(m.player_id) >= ${PUBLIC_LISTING_MIN_MEMBERS}
    ORDER BY ${asAdmin ? sql`s.name` : sql`played_with DESC, member_count DESC, s.name`}
    LIMIT ${asAdmin ? 100 : 30}`;
  return rows.map(row => ({ id: row.id, name: row.name, visibility: row.visibility, memberCount: row.member_count, role: null, playedWith: row.played_with }));
}

/** Players who could be added to a squad: linked to an active member account. */
export async function listSquadEligiblePlayerIds(): Promise<string[]> {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    SELECT DISTINCT state_player_id AS id FROM members WHERE active=true AND state_player_id IS NOT NULL`;
  return rows.map(row => row.id);
}

export async function createSquad(actor: string, name: string, visibility: SquadVisibility): Promise<string> {
  const sql = getSql();
  const id = newId();
  await sql.begin(async tx => {
    // Serialise one player's creates so two quick taps can't both slip under the per-player cap.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`squads:${actor}`}))`;
    if (await squadCountFor(tx, actor) >= MAX_SQUADS_PER_PLAYER) throw new SquadError(msg("你已加入太多球隊，請先退出部分球隊。"));
    await tx`INSERT INTO squads (id,name,visibility,invite_code,created_by) VALUES (${id},${name},${visibility},${newInviteCode()},${actor})`;
    await tx`INSERT INTO squad_members (squad_id,player_id,role,added_by,seen_at) VALUES (${id},${actor},'host',${actor},now())`;
  });
  return id;
}

export async function updateSquad(actor: string, squadId: string, input: { name?: string; visibility?: SquadVisibility; rotateInvite?: boolean }) {
  const sql = getSql();
  await sql.begin(async tx => {
    const { members } = await lockSquad(tx, squadId);
    requireHost(members, actor);
    if (input.name !== undefined) await tx`UPDATE squads SET name=${input.name}, updated_at=now() WHERE id=${squadId}`;
    if (input.visibility !== undefined) await tx`UPDATE squads SET visibility=${input.visibility}, updated_at=now() WHERE id=${squadId}`;
    if (input.rotateInvite) await tx`UPDATE squads SET invite_code=${newInviteCode()}, updated_at=now() WHERE id=${squadId}`;
  });
}

export async function deleteSquad(actor: string, squadId: string) {
  const sql = getSql();
  await sql.begin(async tx => {
    const { members } = await lockSquad(tx, squadId);
    requireHost(members, actor);
    await tx`DELETE FROM squads WHERE id=${squadId}`;
  });
}

/** A host adds someone directly. Refused for anyone without an account, and for anyone who left
    this squad themselves — only they can bring themselves back. Resolves true when a row was added
    (false when they were already in). */
export async function addSquadMember(actor: string, squadId: string, playerId: string): Promise<boolean> {
  const sql = getSql();
  return sql.begin(async tx => {
    const { members } = await lockSquad(tx, squadId);
    requireHost(members, actor);
    if (members.some(member => member.playerId === playerId)) return false;
    if (members.length >= MAX_SQUAD_MEMBERS) throw new SquadError(msg("球隊人數已滿。"));
    if (!await hasActiveAccount(tx, playerId)) throw new SquadError(msg("只可以加入已登記帳戶的球員。"));
    const [exited] = await tx`SELECT 1 FROM squad_exits WHERE squad_id=${squadId} AND player_id=${playerId}`;
    if (exited) throw new SquadError(msg("呢位球員已自行退出，只可以由佢自己經邀請連結重新加入。"));
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`squads:${playerId}`}))`;
    if (await squadCountFor(tx, playerId) >= MAX_SQUADS_PER_PLAYER) throw new SquadError(msg("呢位球員已加入太多球隊。"));
    await tx`INSERT INTO squad_members (squad_id,player_id,role,added_by) VALUES (${squadId},${playerId},'member',${actor})`;
    return true;
  });
}

/** The player joins themselves: through the invite code, or one tap on a public squad. `joined` is
    false when they were already a member. */
export async function joinSquad(actor: string, via: { code: string } | { squadId: string }): Promise<{ id: string; joined: boolean }> {
  const sql = getSql();
  return sql.begin(async tx => {
    const [target] = "code" in via
      ? await tx<{ id: string }[]>`SELECT id FROM squads WHERE invite_code=${via.code}`
      : await tx<{ id: string }[]>`SELECT id FROM squads WHERE id=${via.squadId} AND visibility='public'`;
    if (!target) throw new SquadError("code" in via ? msg("邀請連結無效或已更新。") : msg("搵唔到呢個球隊。"), 404);
    const { members } = await lockSquad(tx, target.id);
    if (members.some(member => member.playerId === actor)) return { id: target.id, joined: false };
    if (members.length >= MAX_SQUAD_MEMBERS) throw new SquadError(msg("球隊人數已滿。"));
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`squads:${actor}`}))`;
    if (await squadCountFor(tx, actor) >= MAX_SQUADS_PER_PLAYER) throw new SquadError(msg("你已加入太多球隊，請先退出部分球隊。"));
    await tx`INSERT INTO squad_members (squad_id,player_id,role,added_by,seen_at) VALUES (${target.id},${actor},'member',${actor},now())`;
    await tx`DELETE FROM squad_exits WHERE squad_id=${target.id} AND player_id=${actor}`;
    return { id: target.id, joined: true };
  });
}

/** Remove `playerId`. When it is the actor themselves this is leaving (always allowed, except for
    the only host of a squad others are still in); otherwise the actor must be a host. */
export async function removeSquadMember(actor: string, squadId: string, playerId: string): Promise<"left" | "removed" | "dissolved"> {
  const sql = getSql();
  return sql.begin(async tx => {
    const { members } = await lockSquad(tx, squadId);
    if (playerId === actor) {
      const outcome = leaveOutcome(members, actor);
      if (!members.some(member => member.playerId === actor)) throw new SquadError(msg("搵唔到呢個球隊。"), 404);
      if (outcome === "last-host") throw new SquadError(msg("你係唯一隊長，請先委任另一位隊長再退出。"), 409);
      if (outcome === "dissolve") { await tx`DELETE FROM squads WHERE id=${squadId}`; return "dissolved" as const; }
      await tx`DELETE FROM squad_members WHERE squad_id=${squadId} AND player_id=${actor}`;
      await tx`INSERT INTO squad_exits (squad_id,player_id) VALUES (${squadId},${actor})
        ON CONFLICT (squad_id,player_id) DO UPDATE SET left_at=now()`;
      return "left" as const;
    }
    requireHost(members, actor);
    const target = members.find(member => member.playerId === playerId);
    if (!target) return "removed" as const;
    // The actor is a host other than the target, so at least one host always remains here.
    await tx`DELETE FROM squad_members WHERE squad_id=${squadId} AND player_id=${playerId}`;
    return "removed" as const;
  });
}

export async function setSquadRole(actor: string, squadId: string, playerId: string, role: SquadRole) {
  const sql = getSql();
  await sql.begin(async tx => {
    const { members } = await lockSquad(tx, squadId);
    requireHost(members, actor);
    const target = members.find(member => member.playerId === playerId);
    if (!target) throw new SquadError(msg("呢位球員唔喺球隊入面。"), 404);
    if (target.role === role) return;
    if (role === "member" && hostsWithout(members, playerId) === 0) throw new SquadError(msg("球隊最少要有一位隊長。"), 409);
    await tx`UPDATE squad_members SET role=${role} WHERE squad_id=${squadId} AND player_id=${playerId}`;
  });
}

/** Acknowledge the "someone added you" notice. */
export async function markSquadSeen(actor: string, squadId: string) {
  const sql = getSql();
  await sql`UPDATE squad_members SET seen_at=now() WHERE squad_id=${squadId} AND player_id=${actor} AND seen_at IS NULL`;
}
