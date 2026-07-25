import HomeClient from "./HomeClient";
import { getCurrentMember } from "../db/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getCurrentMember();
  return <HomeClient user={user} />;
}
