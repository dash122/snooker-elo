import { GET as availability } from "../../availability/route";
import { GET as invites } from "../../invites/route";
import { GET as offers } from "../../offers/route";
import { GET as slots } from "../../slots/route";
import { hkDate } from "../../../../lib/availability";

/** First paint for 約戰.
 *
 * The tab used to fan out to seven serverless functions. Each function lazily opened its own remote
 * Postgres pool, so the page paid several TLS handshakes and could exhaust the Supabase transaction
 * pooler before any useful card appeared. Calling the existing read handlers inside one function
 * keeps their response contracts and permissions intact while sharing one small Postgres pool.
 */
export async function GET(request:Request){
  const url=new URL(request.url);
  const date=url.searchParams.get("date")??hkDate();
  const week=url.searchParams.get("week")??date;
  const days=Math.min(31,Math.max(1,Number(url.searchParams.get("days"))||14));
  const origin=url.origin;
  /* Keep the board out of this Promise.all. Its loader has its own two-phase parallel query group;
     saturating the shared client with both layers at once leaves queued promises with no available
     connection even though Postgres itself is idle. These reads warm the pool, then the board uses
     it immediately in a bounded second phase. */
  const [selectedResponse,calendarResponse,ownResponse,invitesResponse,offersResponse]=await Promise.all([
    availability(new Request(`${origin}/api/availability?date=${encodeURIComponent(date)}`)),
    availability(new Request(`${origin}/api/availability?week=${encodeURIComponent(week)}&days=${days}`)),
    availability(new Request(`${origin}/api/availability?me`)),
    invites(),
    offers(),
  ]);
  const slotsResponse=await slots();
  const [selected,calendar,own,board,inbox,mutual]=await Promise.all([
    selectedResponse.json(),calendarResponse.json(),ownResponse.json(),slotsResponse.json(),
    invitesResponse.json(),offersResponse.json(),
  ]);
  return Response.json({selected,calendar,own,board,inbox,mutual},{headers:{"cache-control":"no-store"}});
}
