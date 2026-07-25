import { deleteCurrentSession } from "../../../../db/auth";

export async function POST(request: Request) {
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/", request.url).toString(), "set-cookie": await deleteCurrentSession() },
  });
}
