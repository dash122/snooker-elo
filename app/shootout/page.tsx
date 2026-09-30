import type {Metadata} from "next";
import ShootoutClient from "./ShootoutClient";
import { getTranslator } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("Shootout Timer｜SCAA Snooker ELO"),
    description: t("專為一位計時員設計的 Snooker Shoot Out 十分鐘計時器。"),
  };
}

export default function ShootoutPage() {
  return <ShootoutClient/>;
}
