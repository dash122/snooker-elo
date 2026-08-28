/** Reconciling the match draft's 讓分 with the cup's own handicap rule.
 *
 *  This lives outside the form because of the bug it exists to prevent. The form used to push the
 *  cup's handicap into the draft from an effect that depended on the freshly-built ELO forecast —
 *  a new object on every render — and wrote a new draft object every time it ran. The draft is
 *  parent state, so a new one re-rendered the form, which rebuilt the forecast, which re-ran the
 *  effect: opening 記錄賽果 on a 建議讓分 cup hit React's update-depth ceiling and threw the whole
 *  page to the error boundary before a score could be typed.
 *
 *  The cure is for the reconciliation to be idempotent: once the draft already carries the cup's
 *  terms, hand back the *same* object so React bails out of the re-render instead of looping. */

export type CupHandicapDraft = { giver:string; points:number|string };

export type CupHandicapTerms = {
  /** The cup's rule. Anything else (including no cup selected yet) leaves the draft alone. */
  handicapMode?:"suggested"|"none";
  /** The club's suggested handicap for this pairing: positive when A gives, negative when B does.
      Null while there is no forecast to derive it from. */
  fairActual:number|null;
  aId:string;
  bId:string;
};

export function applyCupHandicap<D extends CupHandicapDraft>(draft:D,terms:CupHandicapTerms):D {
  const target=cupHandicapTarget(terms);
  if(!target)return draft;
  if(draft.giver===target.giver&&Number(draft.points)===target.points)return draft;
  return {...draft,giver:target.giver,points:target.points};
}

function cupHandicapTarget(terms:CupHandicapTerms):{giver:string;points:number}|null {
  if(terms.handicapMode==="none")return {giver:"",points:0};
  if(terms.handicapMode!=="suggested"||terms.fairActual==null)return null;
  // A zero suggestion is "no handicap", not "A gives 0" — naming a giver for it would light up the
  // 讓分 summary with terms nobody plays to.
  if(terms.fairActual===0)return {giver:"",points:0};
  return {giver:terms.fairActual>0?terms.aId:terms.bId,points:Math.abs(terms.fairActual)};
}
