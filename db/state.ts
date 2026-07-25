// Vercel deployments (with the Supabase Postgres integration) set POSTGRES_URL;
// Cloudflare Workers deployments don't, so they keep using D1. Each backend is
// a dynamic import so bundlers only need to resolve the one actually in use.
function backend() {
  return process.env.POSTGRES_URL ? import("./state.pg") : import("./state.d1");
}

export async function getState() {
  return (await backend()).getState();
}

export async function putState(data: string) {
  return (await backend()).putState(data);
}

export async function deleteState() {
  return (await backend()).deleteState();
}
