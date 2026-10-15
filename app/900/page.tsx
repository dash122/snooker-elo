import type {Metadata} from "next";
import Snooker900Client from "./Snooker900Client";
import { getTranslator } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: t("Snooker 900 計時器｜Snooker ELO"),
    description: t("十五分鐘一局、每桿限時的 Snooker 900 計時器。由坐下的球員按鍵，出桿的球員專心打球。"),
  };
}

export default function Snooker900Page() {
  return <Snooker900Client/>;
}
