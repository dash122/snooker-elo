#!/usr/bin/env node
/* One-off key generation for web push. Run once per deployment and keep the private key secret:
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * The public key is also served to the browser by /api/push/key, so it is not a secret — the private
 * key only ever signs on the server. Rotating them invalidates every stored subscription, which the
 * app recovers from on its own: a rejected endpoint is pruned and the browser re-subscribes. */
import { createECDH } from "node:crypto";

const b64url = buffer => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ecdh = createECDH("prime256v1");
const publicKey = ecdh.generateKeys();

console.log("VAPID_PUBLIC_KEY=%s", b64url(publicKey));
console.log("VAPID_PRIVATE_KEY=%s", b64url(ecdh.getPrivateKey()));
console.log("VAPID_SUBJECT=mailto:you@example.com");
