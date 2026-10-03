import { deleteCurrentSession } from "../../../../db/auth";

export async function POST(request: Request) {
  const headers = new Headers({ location: new URL("/", request.url).toString() });
  for (const cookie of await deleteCurrentSession()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
