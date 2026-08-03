import { createCipheriv, createECDH, createPrivateKey, createSign, hkdfSync, randomBytes } from "node:crypto";

/** Web Push, implemented directly against node:crypto rather than pulling in `web-push`.
 *
 *  Two specs meet here. RFC 8292 (VAPID) proves to the push service who is sending; RFC 8291 encrypts
 *  the payload to the subscriber's key so the push service itself cannot read it. Neither is large,
 *  and the club's deployment carries five runtime dependencies in total — adding a sixth (plus its
 *  transitive tree) to send a few hundred notifications a week is a worse trade than eighty lines.
 *
 *  Everything is env-gated: with no VAPID keys configured `pushConfig()` returns null and the callers
 *  no-op, so the whole feature is inert on a deployment that has not set it up rather than throwing
 *  on every invite. */

export type PushSubscription = { endpoint:string; p256dh:string; auth:string };
export type PushResult = { ok:true } | { ok:false; status:number; gone:boolean; detail:string };

const b64url = (input:Buffer) => input.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const fromB64url = (input:string) => Buffer.from(input.replace(/-/g,"+").replace(/_/g,"/"),"base64");

export function pushConfig() {
  const publicKey=process.env.VAPID_PUBLIC_KEY,privateKey=process.env.VAPID_PRIVATE_KEY;
  if(!publicKey||!privateKey)return null;
  /* A `mailto:` (or https) subject is mandatory in RFC 8292 — push services reject a JWT without one,
     and it is how they reach an operator when a sender misbehaves. */
  const subject=process.env.VAPID_SUBJECT||"mailto:admin@example.com";
  return {publicKey,privateKey,subject};
}

/** The VAPID signing key, rebuilt from the raw base64url scalars that every VAPID generator emits.
    Node cannot import those directly, but it does accept a JWK, and the public key is an uncompressed
    P-256 point (0x04‖x‖y) so x and y can simply be sliced back out of it. */
function signingKey(publicKey:string,privateKey:string) {
  const point=fromB64url(publicKey);
  if(point.length!==65||point[0]!==4)throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 point");
  return createPrivateKey({format:"jwk",key:{
    kty:"EC",crv:"P-256",
    x:b64url(point.subarray(1,33)),y:b64url(point.subarray(33,65)),
    d:b64url(fromB64url(privateKey)),
  }});
}

/** ES256 JWT for one push origin. Scoped to the audience and short-lived (12h, under the 24h ceiling
    the spec allows) so a captured header cannot be replayed against another service indefinitely. */
function vapidHeader(endpoint:string,config:{publicKey:string;privateKey:string;subject:string}) {
  const audience=new URL(endpoint).origin;
  const segment=(value:unknown)=>b64url(Buffer.from(JSON.stringify(value)));
  const unsigned=`${segment({typ:"JWT",alg:"ES256"})}.${segment({aud:audience,exp:Math.floor(Date.now()/1000)+12*60*60,sub:config.subject})}`;
  /* Node emits DER by default; JOSE wants the raw r‖s pair, which is what `ieee-p1363` produces. */
  const signature=createSign("SHA256").update(unsigned).sign({key:signingKey(config.publicKey,config.privateKey),dsaEncoding:"ieee-p1363"});
  return `vapid t=${unsigned}.${b64url(signature)}, k=${config.publicKey}`;
}

const RECORD_SIZE = 4096;

/** RFC 8291 aes128gcm. One record, so the body is simply header‖ciphertext and no chunking is needed —
    payloads here are a couple of hundred bytes against a 4096 record size. */
export function encryptPayload(subscription:PushSubscription,plaintext:string) {
  const userPublic=fromB64url(subscription.p256dh),authSecret=fromB64url(subscription.auth);
  const ecdh=createECDH("prime256v1");
  const serverPublic=ecdh.generateKeys();
  const shared=ecdh.computeSecret(userPublic);
  const salt=randomBytes(16);
  const info=(label:string)=>Buffer.concat([Buffer.from(label,"utf8"),Buffer.from([0])]);
  /* The key-derivation info binds both public keys into the secret, so a payload encrypted for one
     subscriber can never be decrypted with another's key even if the salt repeats. */
  const keyInfo=Buffer.concat([info("WebPush: info"),userPublic,serverPublic]);
  const ikm=Buffer.from(hkdfSync("sha256",shared,authSecret,keyInfo,32));
  const contentKey=Buffer.from(hkdfSync("sha256",ikm,salt,info("Content-Encoding: aes128gcm"),16));
  const nonce=Buffer.from(hkdfSync("sha256",ikm,salt,info("Content-Encoding: nonce"),12));
  const cipher=createCipheriv("aes-128-gcm",contentKey,nonce);
  /* 0x02 is the last-record delimiter; 0x01 would mean "another record follows". */
  const body=Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext,"utf8"),Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
  const header=Buffer.alloc(21);
  salt.copy(header,0);
  header.writeUInt32BE(RECORD_SIZE,16);
  header.writeUInt8(serverPublic.length,20);
  return Buffer.concat([header,serverPublic,body]);
}

/** Deliver one notification.
 *
 *  Never throws: a dead subscription is an ordinary, expected outcome (the member cleared site data,
 *  reinstalled, or revoked permission) and must not take down the invite request that triggered it.
 *  `gone` marks the two statuses that mean "this endpoint will never work again", which is what lets
 *  the caller prune the row instead of retrying it forever. */
export async function sendPush(subscription:PushSubscription,payload:unknown,options?:{ttl?:number;urgency?:"very-low"|"low"|"normal"|"high"}):Promise<PushResult> {
  const config=pushConfig();
  if(!config)return {ok:false,status:0,gone:false,detail:"VAPID keys not configured"};
  try{
    const response=await fetch(subscription.endpoint,{
      method:"POST",
      headers:{
        "authorization":vapidHeader(subscription.endpoint,config),
        "content-encoding":"aes128gcm",
        "content-type":"application/octet-stream",
        "ttl":String(options?.ttl??12*60*60),
        "urgency":options?.urgency??"normal",
      },
      body:encryptPayload(subscription,JSON.stringify(payload)) as unknown as BodyInit,
    });
    if(response.ok)return {ok:true};
    return {ok:false,status:response.status,gone:response.status===404||response.status===410,detail:await response.text().catch(()=>"")};
  }catch(error){
    return {ok:false,status:0,gone:false,detail:error instanceof Error?error.message:"push failed"};
  }
}
