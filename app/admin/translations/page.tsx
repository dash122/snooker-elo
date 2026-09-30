import { BrandLogo } from "../../components/BrandLogo";
import { redirect } from "next/navigation";
import { getCurrentMember } from "../../../db/auth";
import { getTranslationOverrides } from "../../../db/translations";
import { enStrings } from "../../../lib/i18n/messages/en-strings";
import { en } from "../../../lib/i18n/messages/en";
import { zhHant } from "../../../lib/i18n/messages/zh-Hant";
import { ButtonLink } from "../../components/ui/Primitives";
import TranslationEditor, { type TranslationRow } from "./TranslationEditor";

export const dynamic = "force-dynamic";

export default async function AdminTranslationsPage() {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");
  const overrides = await getTranslationOverrides();
  const bundled: Record<string, string> = { ...enStrings, ...en };
  const rows: TranslationRow[] = Object.entries(bundled).map(([key, original]) => ({
    key,
    source: (zhHant as Record<string, string>)[key] ?? key,
    original,
    value: overrides[key] ?? original,
  }));
  return <main className="auth-page admin-page">
    <section className="auth-card admin-card translations-card">
      <BrandLogo className="auth-brand" />
      <p className="kicker">管理員控制台</p>
      <h1>英文翻譯</h1>
      <p className="translations-intro">修改後約 30 秒內於網站生效。佔位符（例如 {"{name}"}）必須保留，英文不可包含中文字元。</p>
      <TranslationEditor rows={rows} />
      <ButtonLink className="admin-back" variant="quiet" href="/admin">返回管理員控制台</ButtonLink>
    </section>
  </main>;
}
