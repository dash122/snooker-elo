import { GET as availability } from "../../availability/route";
import { GET as invites } from "../../invites/route";
import { GET as offers } from "../../offers/route";
import { hkDate } from "../../../../lib/availability";

/** First paint for 約戰.
 *
 * The tab used to fan out to seven serverless functions. Each function lazily opened its own remote
 * Postgres pool, so the page paid several TLS handshakes and could exhaust the Supabase transaction
 * pooler before any useful card appeared. Calling the existing read handlers inside one function
 * keeps their response contracts and permissions intact while sharing one small Postgres pool. The
 * slots board is deliberately loaded by `Slots` through its own endpoint: its query group is heavier
 * and must not delay the availability roster or inbox.
 */
export async function GET(request:Request){
  const url=new URL(request.url);
  const date=url.searchParams.get("date")??hkDate();
  const week=url.searchParams.get("week")??date;
  const days=Math.min(31,Math.max(1,Number(url.searchParams.get("days"))||14));
  const origin=url.origin;
  const [selectedResponse,calendarResponse,ownResponse,invitesResponse,offersResponse]=await Promise.all([
    availability(new Request(`${origin}/api/availability?date=${encodeURIComponent(date)}`)),
    availability(new Request(`${origin}/api/availability?week=${encodeURIComponent(week)}&days=${days}`)),
    availability(new Request(`${origin}/api/availability?me`)),
    invites(),
    offers(),
  ]);
  const [selected,calendar,own,inbox,mutual]=await Promise.all([
    selectedResponse.json(),calendarResponse.json(),ownResponse.json(),invitesResponse.json(),offersResponse.json(),
  ]);
  return Response.json({selected,calendar,own,board:null,inbox,mutual},{headers:{"cache-control":"no-store"}});
}
