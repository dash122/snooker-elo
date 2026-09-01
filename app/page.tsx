import { redirect } from "next/navigation";
import HomeClient from "./HomeClient";
import { getCurrentMember, needsOnboarding } from "../db/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getCurrentMember();
  const onboardingPending = user ? await needsOnboarding(user.email) : false;
  // A member with a still-valid session (up to 30 days) who quits and reopens the
  // app never hits /api/auth/login again, so that route's onboarding redirect never
  // fires for them. This is the app's only entry point — the tabs below are client
  // state inside HomeClient, not separate routes — so catching it here is what
  // makes every reopen, not just every login, land back on the questionnaire.
  if (onboardingPending) redirect("/onboarding?reminder=1");
  /* Rendering the full club state on the server blocks Vite's event loop long enough that other
     Supabase responses sit in ClientRead and eventually hit statement_timeout. HomeClient already
     has a client-side /api/state hydration path; use it so the shell can respond immediately and
     the database payload arrives through the fast, independently bounded API request. */
  return <HomeClient user={user} initialData={null} />;
}
