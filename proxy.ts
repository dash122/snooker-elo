import { NextResponse } from "next/server";

const ADMIN_CACHE_CONTROL = "private, no-store, max-age=0, must-revalidate";

export function proxy(request: Request) {
  const response = NextResponse.next();
  const pathname = new URL(request.url).pathname;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    response.headers.set("Cache-Control", ADMIN_CACHE_CONTROL);
  }

  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
