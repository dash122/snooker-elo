import HomeClient, { type AppState } from "./HomeClient";
import { getCurrentMember, needsOnboarding } from "../db/auth";
import { getState } from "../db/state";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [user, raw] = await Promise.all([getCurrentMember(), getState()]);
  const onboardingPending = user ? await needsOnboarding(user.email) : false;
  const initialData: AppState | null = raw ? JSON.parse(raw) : null;
  return <HomeClient user={user ? { ...user, needsOnboarding: onboardingPending } : null} initialData={initialData} />;
}
