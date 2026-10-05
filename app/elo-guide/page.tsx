import type { Metadata } from "next";
import EloGuideClient from "./EloGuideClient";
import { getTranslator } from "../../lib/i18n/server";
import "./guide.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("評分與讓分指南"),
    description: t("用簡單的例子和互動小遊戲，說明球會的 ELO 評分如何變動，以及讓分如何計算。"),
  };
}

export default function EloGuidePage() {
  return <EloGuideClient />;
}
