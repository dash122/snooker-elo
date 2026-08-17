import { getCurrentMember, savePreliminaryRating } from "../../../db/auth";

const q1Scores = new Map([
  ["700", 700], ["900", 900], ["1100", 1100], ["1300", 1300],
  ["1500", 1500], ["1700", 1700], ["1900", 1900],
]);
const q2Scores = new Map([["2000", 2000], ["2100", 2100], ["2200", 2200], ["2300", 2300]]);

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "未登入。" }, { status: 401 });

  const body = await request.json().catch(() => null) as { q1?: unknown; q2?: unknown } | null;
  const q1 = typeof body?.q1 === "string" ? q1Scores.get(body.q1) : undefined;
  const q2 = typeof body?.q2 === "string" ? q2Scores.get(body.q2) : undefined;
  if (q1 === undefined) return Response.json({ error: "請完成第一條問題。" }, { status: 400 });
  if (q1 === 1900 && q2 === undefined) return Response.json({ error: "請完成第二條問題。" }, { status: 400 });

  const finalRating = q1 === 1900 ? q2! : q1;
  const saved = await savePreliminaryRating(member.email, q1, finalRating, new Date().toISOString());
  if (!saved) return Response.json({ error: "未能儲存評級，請稍後再試。" }, { status: 500 });
  return Response.json({ finalRating });
}