import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import OnboardingQuestionnaire from "./OnboardingQuestionnaire";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ reminder?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  const params = searchParams ? await searchParams : null;
  return <OnboardingQuestionnaire displayName={member.displayName} reminder={params?.reminder === "1"} />;
}