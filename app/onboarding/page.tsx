import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import OnboardingWizard from "./OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ reminder?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  const params = searchParams ? await searchParams : null;
  return <OnboardingWizard
    member={{
      displayName: member.displayName, username: member.username, email: member.email,
      avatar: member.avatar, initials: member.initials, iconColour: member.iconColour,
    }}
    reminder={params?.reminder === "1"}
  />;
}
