import { requireMember } from "../../../../db/auth";
import { playDatabase } from "../../../../db/play.pg";
import { PlayError, venueAdmin, type VenueAdminAction } from "../../../../db/play-store";
import { getTranslator } from "../../../../lib/i18n/server";

const headers = { "cache-control": "no-store" };
const ACTIONS: VenueAdminAction[] = ["approve", "reject", "edit", "merge"];

/** Every venue with who added it and how many sessions use it, unverified ones first. */
export async function GET() {
  const { t } = await getTranslator();
  const admin = await requireMember("admin");
  if (!admin) return Response.json({ error: t("需要管理員權限。") }, { status: 403, headers });
  const venues = await playDatabase().query(`SELECT v.id,v.name,v.name_en AS "nameEn",v.city,v.tz,v.lat,v.lng,v.status,v.active,v.merged_into AS "mergedInto",
      p.name AS "createdByName",(SELECT count(*)::int FROM play_sessions s WHERE s.venue_id=v.id) AS sessions
    FROM venues v LEFT JOIN state_players p ON p.id=v.created_by
    ORDER BY (v.status='unverified') DESC,v.name,v.id`);
  return Response.json({ venues }, { headers });
}

export async function POST(request: Request) {
  const { t } = await getTranslator();
  const admin = await requireMember("admin");
  if (!admin) return Response.json({ error: t("需要管理員權限。") }, { status: 403, headers });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!ACTIONS.includes(body.action as VenueAdminAction)) return Response.json({ error: t("無效操作。") }, { status: 400, headers });
    const out = await venueAdmin(playDatabase(), body.action as VenueAdminAction, body);
    return Response.json({ ok: true, ...out }, { headers });
  } catch (error) {
    if (error instanceof PlayError) return Response.json({ error: t(error.message) }, { status: error.status, headers });
    console.error(JSON.stringify({ level: "error", msg: "venue_admin_failed", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: t("未能更新場地。") }, { status: 500, headers });
  }
}
