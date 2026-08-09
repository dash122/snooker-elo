import type { Metadata, Viewport } from "next";
import "./styles/tokens.css";
import "./styles/foundation.css";
import "./styles/components.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCAA Snooker ELO｜讓每一局都推動進步",
  description: "為球會而設的公開 ELO 排名、賽果追蹤與公平讓分建議，讓每場對賽更接近、更有競爭力。",
  manifest: "/manifest.json",
  appleWebApp: {
    title: "Snooker ELO",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f0e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b2d29" },
  ],
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
