import { requireMember } from "../../../../db/auth";
import { cancelAvailability, updateAvailability } from "../../../../db/availability";
import { validateAvailabilityInterval } from "../../../../lib/availability";

async function member(){const current=await requireMember();return current?.statePlayerId?current:null;}
function valid(body:unknown){const value=body as {startAt?:unknown;endAt?:unknown};return validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const current=await member();if(!current)return Response.json({error:"A linked member account is required"},{status:403});try{const slots=await updateAvailability((await params).id,current.statePlayerId!,valid(await request.json()));return slots?Response.json({slots}):Response.json({error:"Slot not found"},{status:404});}catch(error){return Response.json({error:error instanceof Error?error.message:"Invalid slot"},{status:400});}}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){const current=await member();if(!current)return Response.json({error:"A linked member account is required"},{status:403});return await cancelAvailability((await params).id,current.statePlayerId!)?Response.json({ok:true}):Response.json({error:"Slot not found"},{status:404});}
