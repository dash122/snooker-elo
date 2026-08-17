import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import OnboardingQuestionnaire from "./OnboardingQuestionnaire";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  return <OnboardingQuestionnaire displayName={member.displayName} />;
}