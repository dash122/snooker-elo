import { requireMember } from "../../../../db/auth";

/** Reads a whiteboard photo of a 波鐘 tally and returns {label, amount} guesses for the member to
 *  review before saving — never written directly to a session. Entirely optional: with no
 *  ANTHROPIC_API_KEY set, this 501s and the client falls back to manual entry, same as the app's
 *  other optional integrations (Resend email, push notifications). */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PROMPT = `This photo shows a handwritten whiteboard tally from a snooker club, tracking a table-fee "count" (波鐘) per player. Each entry is a player's initials or short name next to a number, which may be written as a running total possibly stacked above an earlier total (e.g. a fraction-like column of numbers for the same player - use the latest/bottom value). Read the board and return ONLY a JSON array, no prose, of objects {"label": string, "amount": number}, one per player group, using their initials/name exactly as written and their current (latest) total as amount. If nothing legible is found, return [].`;

export async function POST(request: Request) {
  const user = await requireMember();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "OCR is not configured on this deployment" }, { status: 501 });

  try {
    const body = await request.json().catch(() => null);
    const dataUrl: string | undefined = body?.image;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return Response.json({ error: "Expected a data:image/* image" }, { status: 400 });
    }
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) return Response.json({ error: "Invalid image data" }, { status: 400 });
    const [, mediaType, base64] = match;
    if (base64.length * 0.75 > MAX_IMAGE_BYTES) return Response.json({ error: "Image too large" }, { status: 400 });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    if (!response.ok) {
      console.error("fee session OCR error:", response.status, await response.text().catch(() => ""));
      return Response.json({ error: "OCR request failed" }, { status: 502 });
    }
    const payload = await response.json() as { content?: { type: string; text?: string }[] };
    const text = payload.content?.find(block => block.type === "text")?.text ?? "";
    const jsonMatch = /\[[\s\S]*\]/.exec(text);
    let parsed: unknown = [];
    try { parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : []; } catch { parsed = []; }
    const entries = Array.isArray(parsed)
      ? parsed
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map(item => ({ label: String(item.label ?? "").trim().slice(0, 24), amount: Number(item.amount) }))
          .filter(item => item.label && Number.isFinite(item.amount))
      : [];
    return Response.json({ entries });
  } catch (error) {
    console.error("fee session OCR error:", error);
    return Response.json({ error: "OCR request failed" }, { status: 500 });
  }
}
