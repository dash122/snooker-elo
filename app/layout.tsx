import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCAA Snooker ELO",
  description: "公開、清晰、可追溯的 SCAA Snooker ELO 排名及賽果追蹤。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
