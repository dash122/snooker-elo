import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import AccountDashboard from "./AccountDashboard";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const [params, member] = await Promise.all([searchParams, getCurrentMember()]);
  if (!member) redirect("/login");

  return <AccountDashboard member={member} googleStatus={params.google} />;
}