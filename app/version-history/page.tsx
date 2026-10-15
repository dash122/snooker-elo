import type { Metadata } from "next";
import { BrandLogo } from "../components/BrandLogo";
import { LanguageMenu } from "../components/shell/LanguageMenu";
import { ButtonLink, Surface } from "../components/ui/Primitives";
import { formatDate } from "../../lib/i18n/format";
import { DEFAULT_TIME_ZONE } from "../../lib/i18n/locales";
import { getTranslator } from "../../lib/i18n/server";
import { VERSION_HISTORY } from "../../lib/version-history";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("版本記錄"),
    description: t("記錄本應用每次更新的內容。"),
  };
}

export default async function VersionHistoryPage() {
  const { t, locale } = await getTranslator();
  return <main className="version-history">
    <header className="version-top">
      <div className="version-wrap">
        <BrandLogo compact />
        <LanguageMenu tone="dark" />
      </div>
    </header>
    <div className="version-wrap version-body">
      <div className="version-intro">
        <h1>{t("版本記錄")}</h1>
        <p>{t("每次更新都會記錄在這裡，由最新開始排列。")}</p>
        <ButtonLink variant="secondary" href="/">{t("返回排行榜")}</ButtonLink>
      </div>
      <ol className="version-list">
        {VERSION_HISTORY.map((release, index) => <li key={release.version}>
          <Surface as="article" className="version-release">
            <header className="version-release-head">
              <h2>v{release.version}</h2>
              {index === 0 && <span className="version-current">{t("目前版本")}</span>}
              <time dateTime={release.date}>{formatDate(`${release.date}T12:00:00+08:00`, { locale, timeZone: DEFAULT_TIME_ZONE })}</time>
            </header>
            <ul>
              {release.changes.map(change => <li key={change}>{t(change)}</li>)}
            </ul>
          </Surface>
        </li>)}
      </ol>
    </div>
  </main>;
}
