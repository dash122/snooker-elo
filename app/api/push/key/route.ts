import { pushConfig } from "../../../../lib/web-push";

/* The VAPID public key is public by design — the browser needs it to build a subscription. Returning
   `null` rather than a 404 when it is unset lets the client tell "this deployment has not enabled
   push" apart from "the request failed", and show the right thing either way. */
export async function GET(){
  const config=pushConfig();
  return Response.json({key:config?.publicKey??null},{headers:{"cache-control":"public, max-age=3600"}});
}
