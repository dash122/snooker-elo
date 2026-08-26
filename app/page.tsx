import HomeClient from "./HomeClient";
import { getCurrentMember, needsOnboarding } from "../db/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getCurrentMember();
  const onboardingPending = user ? await needsOnboarding(user.email) : false;
  /* Rendering the full club state on the server blocks Vite's event loop long enough that other
     Supabase responses sit in ClientRead and eventually hit statement_timeout. HomeClient already
     has a client-side /api/state hydration path; use it so the shell can respond immediately and
     the database payload arrives through the fast, independently bounded API request. */
  return <HomeClient user={user ? { ...user, needsOnboarding: onboardingPending } : null} initialData={null} />;
}
