import type { Metadata } from "next";
import EloGuideClient from "./EloGuideClient";
import "./guide.css";

export const metadata: Metadata = {
  title: "How SCAA Snooker ELO Works",
  description: "A business-school-friendly field note on the SCAA Snooker ELO model.",
};

export default function EloGuidePage() {
  return <EloGuideClient />;
}
