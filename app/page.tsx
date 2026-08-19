import HomeClient from "./HomeClient";
import { getCurrentMember, needsOnboarding } from "../db/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getCurrentMember();
  const onboardingPending = user ? await needsOnboarding(user.email) : false;
  return <HomeClient user={user ? { ...user, needsOnboarding: onboardingPending } : null} />;
}
