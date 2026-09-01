import { getCurrentMember, savePreliminaryRating } from "../../../db/auth";

const q1Scores = new Map([
  ["450", 450], ["550", 550], ["1000", 1000], ["1200", 1200],
  ["1500", 1500], ["1700", 1700], ["1900", 1900], ["2100", 2100],
  ["2400", 2400], ["2800", 2800], ["3300", 3300],
]);

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "未登入。" }, { status: 401 });

  const body = await request.json().catch(() => null) as { q1?: unknown } | null;
  const q1 = typeof body?.q1 === "string" ? q1Scores.get(body.q1) : undefined;
  if (q1 === undefined) return Response.json({ error: "請完成第一條問題。" }, { status: 400 });

  const finalRating = q1;
  const saved = await savePreliminaryRating(member.email, q1, finalRating, new Date().toISOString());
  if (!saved) return Response.json({ error: "未能儲存評級，請稍後再試。" }, { status: 500 });
  return Response.json({ finalRating });
}
