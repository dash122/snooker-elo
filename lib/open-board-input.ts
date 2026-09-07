import { validateAvailabilityInterval } from "./availability";
import type { CreateCallInput, Tempo } from "../db/open-board";

/* Shared between posting a new 局 and editing one — the edit composer reopens the same fields the
   create composer collects, so the parsing and its limits have to match, not just resemble each
   other, or a value legal on create could get silently clamped differently on edit. */

export const oneOf = <T extends string>(value:unknown,allowed:readonly T[],fallback:T):T =>
  typeof value==="string"&&(allowed as readonly string[]).includes(value)?value as T:fallback;

export function parseCallInput(input:unknown):CreateCallInput {
  const value=input as Record<string,unknown>;
  const interval=validateAvailabilityInterval({startAt:String(value.startAt),endAt:String(value.endAt)});
  const cap=Number(value.maxPlayers);
  return {
    startAt:interval.startAt, endAt:interval.endAt,
    message:typeof value.message==="string"?value.message.trim().slice(0,300):"",
    venueId:typeof value.venueId==="string"&&value.venueId?value.venueId:null,
    venueIntent:typeof value.venueIntent==="string"?value.venueIntent.trim().slice(0,60):"",
    tempo:oneOf<Tempo>(value.tempo,["sport","casual"],"sport"),
    handicapPref:oneOf(value.handicapPref,["even","handicap"] as const,"even"),
    costSplit:oneOf(value.costSplit,["aa","host"] as const,"aa"),
    smoking:oneOf(value.smoking,["nonsmoking","any"] as const,"nonsmoking"),
    /* NULL is the default and the normal state. A cap is an unusual request — a fixed doubles
       match — not something the composer should push members towards. */
    maxPlayers:Number.isFinite(cap)&&cap>=2&&cap<=8?Math.trunc(cap):null,
  };
}
