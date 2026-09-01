import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The admin UI contains member data and is commonly opened from an
        // installed PWA. A stale prefetched RSC response can otherwise keep
        // the app showing an old/failed admin render until its router cache is
        // evicted, which is not practical on iOS standalone mode.
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
