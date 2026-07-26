import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// Local development is Node + Supabase by default. Set CLOUDFLARE_RUNTIME=1
// only when explicitly testing the Worker/D1 deployment runtime.
const useCloudflareRuntime = process.env.CLOUDFLARE_RUNTIME === "1";

export default defineConfig(async () => {
  const plugins = [vinext(), sites()];

  if (useCloudflareRuntime) {
    const hostingConfig = (await import("./.openai/hosting.json")).default;
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: hostingConfig.d1
            ? [{ binding: hostingConfig.d1, database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000" }]
            : [],
          r2_buckets: hostingConfig.r2
            ? [{ binding: hostingConfig.r2, bucket_name: "site-creator-r2" }]
            : [],
        },
      }),
    );
  }

  return { plugins };
});