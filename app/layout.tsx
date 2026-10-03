import type { Metadata, Viewport } from "next";
import "./styles/tokens.css";
import "./styles/foundation.css";
import "./styles/components.css";
import "./styles/list-primitives.css";
import "./styles/core-ranking.css";
import "./styles/matchmaking.css";
import "./styles/matchmaking-timeline.css";
import "./styles/venue-board.css";
import "./styles/week-band.css";
import "./styles/cup.css";
import "./styles/calibration.css";
import "./styles/home.css";
import "./styles/break-nudge.css";
import "./styles/squads.css";
import "./styles/squad-stats.css";
import "./styles/match-entry-form.css";
import "./styles/player-picker.css";
import "./styles/calendar.css";
import "./styles/member-auth.css";
import "./styles/admin-roster.css";
import "./styles/admin-reports.css";
import "./styles/admin-translations.css";
import "./styles/member-dashboard.css";
import "./styles/players-tab.css";
import "./styles/modal-sheet.css";
import "./styles/matchmaking-status.css";
import "./styles/matchmaking-marketplace.css";
import "./globals.css";
import "./styles/bottom-nav.css";
import "./styles/ranking-table-mobile.css";
import "./styles/onboarding.css";
import "./styles/elo-trend.css";
import "./styles/elo-trend-dense.css";
import "./styles/guest-intro.css";
import "./styles/shootout.css";
import "./styles/clubhouse-refinement.css";
import "./styles/home-compact.css";
import "./styles/language-menu.css";
import "./styles/menu.css";
import "./styles/app-header.css";
import "./styles/en-typography.css";
import "./styles/matches.css";
import "./styles/segmented.css";
import "./styles/profile-progress.css";
import "./styles/result-colours.css";
import { AddToHomeScreen } from "./components/AddToHomeScreen";
import { I18nProvider } from "./components/I18nProvider";
import { TimeZoneSync } from "./components/TimeZoneSync";
import { getMessages, getPreferences } from "../lib/i18n/server";
import { createTranslator } from "../lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getPreferences();
  const t = createTranslator(locale, await getMessages(locale));
  return {
  title: t("app.title"),
  description: t("app.description"),
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/brand/snooker-elo-flaticon/snooker-elo-flaticon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/snooker-elo-flaticon/snooker-elo-flaticon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/brand/snooker-elo-flaticon/snooker-elo-flaticon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    title: "Snooker ELO",
    statusBarStyle: "default",
  },
};
}

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f0e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b2d29" },
  ],
};

export default async function RootLayout({children}:{children:React.ReactNode}) {
  const { locale, timeZone } = await getPreferences();
  return <html lang={locale}><body><I18nProvider locale={locale} timeZone={timeZone} messages={await getMessages(locale)}>{children}<AddToHomeScreen/><TimeZoneSync/></I18nProvider></body></html>;
}
