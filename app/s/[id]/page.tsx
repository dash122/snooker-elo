import { getCurrentMember } from "../../../db/auth";
import { sharedSlot } from "../../../db/availability";
import SlotPreview from "./SlotPreview";

export const dynamic = "force-dynamic";

/** The guest landing page behind a shared link — readable by anyone the link reaches, WhatsApp group
    included, before they have opened the app at all. Signing in only becomes necessary the moment
    somebody actually wants to raise a hand. */
export default async function SharedSlotPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const [user,slot]=await Promise.all([getCurrentMember(),sharedSlot(id)]);
  return <SlotPreview id={id} slot={slot} signedIn={Boolean(user?.statePlayerId)}/>;
}
