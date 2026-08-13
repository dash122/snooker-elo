import { getSql } from "./sql";
import { ensureInviteSchema } from "./invites.pg";
import { AVAILABILITY_GRACE_MINUTES, type MutualOffer } from "../lib/availability";

/** Mutual match offers: the club asking two members at once whether they want the game, instead of
 *  one member asking the other and risking a no.
 *
 *  The asymmetry that matters is in what each side is told. Both are asked; neither is ever told the
 *  other's answer unless both said yes. A declined offer simply goes quiet, so "no" costs a member
 *  nothing socially — which is the entire reason this exists alongside directed invites. */

let schemaReady:Promise<unknown>|null=null;
export async function ensureOfferSchema(){ return ensureSchema(); }
async function ensureSchema(){
  // Schema changes are deployment-owned; request-time DDL can block all readers.
  return Promise.resolve();

  schemaReady??=(async()=>{
    const sql=getSql();
    /* The pair is stored in a fixed order (a < b) so that "is there already an offer between these
       two" is a single unique index rather than a two-way search. Every read normalises the same
       way, so which member happened to publish first never changes the row's identity. */
    await sql`CREATE TABLE IF NOT EXISTS match_offers (
      id text PRIMARY KEY,
      a_player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      b_player_id text NOT NULL REFERENCES state_players(id) ON DELETE CASCADE,
      start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
      venue text NOT NULL DEFAULT '',
      a_response text NOT NULL DEFAULT 'pending',
      b_response text NOT NULL DEFAULT 'pending',
      status text NOT NULL DEFAULT 'live',
      created_at timestamptz NOT NULL DEFAULT now(),
      settled_at timestamptz,
      CHECK (end_at > start_at), CHECK (a_player_id < b_player_id),
      CHECK (a_response IN ('pending','yes','no')), CHECK (b_response IN ('pending','yes','no')),
      CHECK (status IN ('live','matched','dead','expired'))
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS match_offers_live_pair_idx ON match_offers (a_player_id,b_player_id) WHERE status='live'`;
    await sql`CREATE INDEX IF NOT EXISTS match_offers_a_idx ON match_offers (a_player_id,status)`;
    await sql`CREATE INDEX IF NOT EXISTS match_offers_b_idx ON match_offers (b_player_id,status)`;
  })().catch(error=>{schemaReady=null;throw error;});
  return schemaReady;
}

const pair=(x:string,y:string)=>x<y?{a:x,b:y}:{a:y,b:x};

export async function expireStaleOffers(){
  const sql=getSql();
  await sql`UPDATE match_offers SET status='expired',settled_at=now()
    WHERE status='live' AND start_at<=now()-make_interval(mins => ${AVAILABILITY_GRACE_MINUTES})`;
}

const offerColumns=`o.id,o.start_at AS "startAt",o.end_at AS "endAt",o.venue,o.status,o.created_at AS "createdAt",
  o.a_player_id AS "aId",o.b_player_id AS "bId",o.a_response AS "aResponse",o.b_response AS "bResponse",
  p.id AS "oppId",p.name AS "oppName",p.short AS "oppShort",p.rating::float8 AS "oppRating",p.colour AS "oppColour",p.avatar AS "oppAvatar"`;

/** Everything this member has been asked about. The opponent join flips on which side they are, and
    the other side's response is dropped on the floor before it ever leaves the server. */
export async function listOffersFor(playerId:string):Promise<MutualOffer[]>{
  await ensureSchema(); await expireStaleOffers(); const sql=getSql();
  const rows=await sql<any[]>`
    SELECT ${sql.unsafe(offerColumns)} FROM match_offers o
    JOIN state_players p ON p.id = CASE WHEN o.a_player_id=${playerId} THEN o.b_player_id ELSE o.a_player_id END
    WHERE (o.a_player_id=${playerId} OR o.b_player_id=${playerId}) AND o.status IN ('live','matched')
    ORDER BY o.start_at ASC`;
  return rows.map(row=>({
    id:row.id,startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString(),
    venue:row.venue??"",status:row.status,createdAt:new Date(row.createdAt).toISOString(),
    opponent:{id:row.oppId,name:row.oppName,short:row.oppShort,rating:Number(row.oppRating),colour:row.oppColour,avatar:row.oppAvatar},
    myResponse:row.aId===playerId?row.aResponse:row.bResponse,
  }));
}

/** Every player this member should not be offered right now: already in a live offer with them, or
    already mid-invite, or already holding a confirmed game together. Feeding this into the proposer
    is what stops the club asking "打唔打?" about a match the two have already arranged. */
export async function engagedWith(playerId:string):Promise<string[]>{
  await ensureSchema(); await ensureInviteSchema(); const sql=getSql();
  const rows=await sql<{id:string}[]>`
    SELECT CASE WHEN a_player_id=${playerId} THEN b_player_id ELSE a_player_id END AS id
      FROM match_offers WHERE status='live' AND (a_player_id=${playerId} OR b_player_id=${playerId})
    UNION
    SELECT CASE WHEN from_player_id=${playerId} THEN to_player_id ELSE from_player_id END AS id
      FROM match_invites WHERE status IN ('pending','accepted') AND (from_player_id=${playerId} OR to_player_id=${playerId})`;
  return rows.map(row=>row.id);
}

export type CreatedOffer={id:string;opponentId:string;startAt:string;endAt:string};

/** Record the proposals the matcher chose. `ON CONFLICT DO NOTHING` against the live-pair index makes
    this safe to run concurrently — two members publishing overlapping time at the same moment race
    for the same row, and the loser silently does nothing rather than creating a duplicate ask. */
export async function createOffers(playerId:string,proposals:{opponentId:string;startAt:string;endAt:string}[],venue=""):Promise<CreatedOffer[]>{
  if(!proposals.length)return [];
  await ensureSchema(); await expireStaleOffers(); const sql=getSql();
  const created:CreatedOffer[]=[];
  for(const proposal of proposals){
    const id=crypto.randomUUID(),{a,b}=pair(playerId,proposal.opponentId);
    const rows=await sql<{id:string}[]>`INSERT INTO match_offers (id,a_player_id,b_player_id,start_at,end_at,venue)
      VALUES (${id},${a},${b},${proposal.startAt},${proposal.endAt},${venue})
      ON CONFLICT DO NOTHING RETURNING id`;
    if(rows[0])created.push({id,opponentId:proposal.opponentId,startAt:proposal.startAt,endAt:proposal.endAt});
  }
  return created;
}

export type OfferOutcome={offer:MutualOffer|null;matched:boolean;opponentId:string|null;startAt:string|null;endAt:string|null};

/** Answer an offer.
 *
 *  Both sides yes turns it into a confirmed game, written through as an accepted invite for exactly
 *  the reason `claimOpenCall` does the same: the rest of the app — status card, upcoming list,
 *  post-slot follow-up — already understands accepted invites and should not have to learn a second
 *  notion of "a confirmed game".
 *
 *  Either side saying no kills the offer immediately. It is not marked as "declined by X" anywhere a
 *  member can see, and no notification goes to the other side. */
export async function respondOffer(id:string,playerId:string,answer:"yes"|"no"):Promise<OfferOutcome>{
  await ensureSchema(); await ensureInviteSchema(); const sql=getSql();
  const outcome=await sql.begin(async tx=>{
    const rows=await tx<any[]>`SELECT id,a_player_id AS "aId",b_player_id AS "bId",a_response AS "aResponse",b_response AS "bResponse",start_at AS "startAt",end_at AS "endAt",venue
      FROM match_offers WHERE id=${id} AND status='live' AND (a_player_id=${playerId} OR b_player_id=${playerId}) FOR UPDATE`;
    const row=rows[0];
    if(!row)return null;
    const mine=row.aId===playerId?"a":"b";
    const theirs=mine==="a"?row.bResponse:row.aResponse;
    const bothYes=answer==="yes"&&theirs==="yes";
    const status=answer==="no"?"dead":bothYes?"matched":"live";
    await tx`UPDATE match_offers SET
      a_response=${mine==="a"?answer:row.aResponse},b_response=${mine==="b"?answer:row.bResponse},
      status=${status},settled_at=${status==="live"?null:new Date()} WHERE id=${id}`;
    if(bothYes){
      /* The offer's originating side becomes the invite's sender purely so the row has a direction;
         nothing downstream treats the two participants differently once it is accepted. */
      await tx`INSERT INTO match_invites (id,from_player_id,to_player_id,start_at,end_at,message,venue,status,responded_at)
        VALUES (${crypto.randomUUID()},${row.aId},${row.bId},${row.startAt},${row.endAt},'',${row.venue??""},'accepted',now())`;
    }
    return {matched:bothYes,opponentId:mine==="a"?row.bId:row.aId,
      startAt:new Date(row.startAt).toISOString(),endAt:new Date(row.endAt).toISOString()};
  });
  if(!outcome)return {offer:null,matched:false,opponentId:null,startAt:null,endAt:null};
  const offers=await listOffersFor(playerId);
  return {offer:offers.find(item=>item.id===id)??null,...outcome};
}
