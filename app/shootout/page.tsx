import type {Metadata} from "next";
import ShootoutClient from "./ShootoutClient";

export const metadata: Metadata = {
  title: "Shootout Timer｜SCAA Snooker ELO",
  description: "專為一位計時員設計的 Snooker Shoot Out 十分鐘計時器。",
};

export default function ShootoutPage() {
  return <ShootoutClient/>;
}
