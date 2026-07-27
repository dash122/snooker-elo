import { getCurrentMember } from "../../db/auth";
import AuthExperience from "./AuthExperience";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string; welcome?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentMember(), searchParams]);
  const mode = params.mode === "signup" ? "signup" : "login";
  return <AuthExperience user={user} mode={mode} error={params.error} welcome={params.welcome === "1"}/>;
}