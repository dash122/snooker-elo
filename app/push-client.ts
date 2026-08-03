"use client";

/** Browser side of web push. Everything here is defensive: Safari on iOS only exposes push to an
    installed PWA, older browsers expose none of it, and a member can revoke permission at any time —
    so every entry point returns a state rather than throwing. */

export type PushState = "unsupported" | "denied" | "default" | "granted" | "subscribed";

export function pushSupported(){
  return typeof window!=="undefined"&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window;
}

const urlBase64ToUint8Array=(base64:string)=>{
  const padded=(base64+"=".repeat((4-base64.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(padded),output=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i+=1)output[i]=raw.charCodeAt(i);
  return output;
};

export async function registerServiceWorker(){
  if(!pushSupported())return null;
  try{ return await navigator.serviceWorker.register("/sw.js",{scope:"/"}); }catch{ return null; }
}

export async function pushState():Promise<PushState>{
  if(!pushSupported())return "unsupported";
  if(Notification.permission==="denied")return "denied";
  const registration=await navigator.serviceWorker.getRegistration();
  const existing=await registration?.pushManager.getSubscription();
  if(existing)return "subscribed";
  return Notification.permission==="granted"?"granted":"default";
}

/** Ask, subscribe, and register the endpoint with the club. Returns the resulting state so the caller
    can explain what happened rather than silently doing nothing when a member taps "block". */
export async function enablePush():Promise<PushState>{
  if(!pushSupported())return "unsupported";
  const permission=await Notification.requestPermission();
  if(permission!=="granted")return permission==="denied"?"denied":"default";
  const registration=await registerServiceWorker();
  if(!registration)return "unsupported";
  await navigator.serviceWorker.ready;
  const response=await fetch("/api/push/key");
  const {key}=await response.json();
  if(!key)return "granted"; // Server has no VAPID keys configured; nothing to subscribe to.
  const existing=await registration.pushManager.getSubscription();
  const subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key)});
  const raw=subscription.toJSON() as {endpoint?:string;keys?:{p256dh?:string;auth?:string}};
  const saved=await fetch("/api/push/subscribe",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({endpoint:raw.endpoint,p256dh:raw.keys?.p256dh,auth:raw.keys?.auth}),
  });
  return saved.ok?"subscribed":"granted";
}

export async function disablePush(){
  if(!pushSupported())return "default" as PushState;
  const registration=await navigator.serviceWorker.getRegistration();
  const subscription=await registration?.pushManager.getSubscription();
  if(subscription){
    /* Tell the server first: unsubscribing locally succeeds even when offline, and an endpoint that
       is dead in the browser but live in the database is exactly how members end up with pushes they
       thought they had switched off. */
    await fetch("/api/push/subscribe",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:subscription.endpoint})}).catch(()=>{});
    await subscription.unsubscribe().catch(()=>{});
  }
  return (Notification.permission==="granted"?"granted":"default") as PushState;
}
