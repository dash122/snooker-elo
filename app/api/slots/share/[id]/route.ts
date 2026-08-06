import { sharedSlot } from "../../../../../db/availability";

/** The public preview behind a shared link — readable without signing in, exactly like an open call
    always was. This is the surface that lets a WhatsApp group see a slot before anyone in it has
    opened the app; raising a hand is the first thing that requires an account. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const slot=await sharedSlot(id);
  if(!slot)return Response.json({error:"呢張局搵唔到，可能已經夾咗或者過期。"},{status:404});
  return Response.json({slot},{headers:{"cache-control":"no-store"}});
}
