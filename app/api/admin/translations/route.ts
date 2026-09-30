import { requireMember } from "../../../../db/auth";
import { clearTranslationOverride, setTranslationOverride } from "../../../../db/translations";
import { enStrings } from "../../../../lib/i18n/messages/en-strings";
import { en } from "../../../../lib/i18n/messages/en";
import { zhHant } from "../../../../lib/i18n/messages/zh-Hant";

const HAN = /[㐀-鿿＀-￯　-〿]/;
const holes = (text: string) => new Set([...text.matchAll(/\{(\w+)/g)].map(match => match[1]));

/** Same rules tests/i18n.test.mjs enforces on the bundled catalogue, so an edit cannot break a screen. */
function validate(key: string, value: string): string | null {
  const known = key in enStrings || key in en;
  if (!known) return "Unknown key";
  if (!value.trim()) return "Translation cannot be empty";
  if (value.length > 2000) return "Translation is too long";
  if (HAN.test(value)) return "English text cannot contain Chinese characters or full-width punctuation";
  const source = (zhHant as Record<string, string>)[key] ?? key;
  const provided = holes(source);
  for (const name of holes(value)) if (!provided.has(name) && !holes(enStrings[key] ?? en[key as keyof typeof en] ?? "").has(name)) return `{${name}} is not a placeholder of the source text`;
  return null;
}

export async function PUT(request: Request) {
  const admin = await requireMember("admin");
  if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { key?: unknown; value?: unknown } | null;
  if (typeof body?.key !== "string" || typeof body.value !== "string") return Response.json({ error: "Invalid request" }, { status: 400 });
  const problem = validate(body.key, body.value);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  await setTranslationOverride(body.key, body.value.trim(), admin.username);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await requireMember("admin");
  if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { key?: unknown } | null;
  if (typeof body?.key !== "string") return Response.json({ error: "Invalid request" }, { status: 400 });
  await clearTranslationOverride(body.key);
  return Response.json({ ok: true });
}
