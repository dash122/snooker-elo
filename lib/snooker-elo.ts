export type SnookerEloInput = {
  ratingA: number;
  ratingB: number;
  handicapA: number;
  framesA: number;
  framesB: number;
  /** The "500" in the frame-probability exponent. Larger values compress the probability gap
      produced by a given ELO difference. Defaults to the PDF spec's value. */
  handicapEloScale?: number;
  /** The "25" converting a handicap point into ELO ("25H"). Also drives the club's suggested
      handicap (ELO difference ÷ this value) — see `lib/handicap.ts`. */
  handicapPointsToElo?: number;
  /** How much of the handicap's ELO-equivalent actually offsets the underlying rating gap, from 0
      (handicap has no effect on the odds) to 1 (a "fair" handicap makes the match exactly 50/50,
      the PDF's default). Below 1, a bigger ELO gap leaves a proportionally bigger residual edge for
      the stronger player even when the recommended handicap is applied — a fixed points head start
      does not fully cancel a real skill gap over one match. */
  handicapEffectiveness?: number;
  /** The "150" multiplying the match-length scaling factor. */
  frameScaleCoefficient?: number;
  /** The "10" in "(n+10)/10". Raising it flattens the scaling factor's growth with n. */
  frameScaleBase?: number;
  /** The "3" dividing the raw over/under-performance inside tanh(). */
  performanceTanhDivisor?: number;
  /** The "2" in the win/loss bonus of ±2n. */
  winBonusMultiplier?: number;
};

export type SnookerEloResult = {
  probabilityA: number;
  expectedFramesA: number;
  scale: number;
  performance: number;
  bonus: number;
  deltaA: number;
};

export function calculateSnookerElo(input: SnookerEloInput): SnookerEloResult {
  const handicapEloScale = input.handicapEloScale ?? 500;
  const handicapPointsToElo = input.handicapPointsToElo ?? 25;
  const handicapEffectiveness = input.handicapEffectiveness ?? 1;
  const frameScaleCoefficient = input.frameScaleCoefficient ?? 150;
  const frameScaleBase = input.frameScaleBase ?? 10;
  const performanceTanhDivisor = input.performanceTanhDivisor ?? 3;
  const winBonusMultiplier = input.winBonusMultiplier ?? 2;

  const totalFrames = input.framesA + input.framesB;
  if (totalFrames <= 0) {
    return { probabilityA: .5, expectedFramesA: 0, scale: 0, performance: 0, bonus: 0, deltaA: 0 };
  }

  const handicapElo = handicapEffectiveness * handicapPointsToElo * input.handicapA;
  const probabilityA = 1 / (1 + 10 ** (-(input.ratingA - input.ratingB + handicapElo) / handicapEloScale));
  const expectedFramesA = probabilityA * totalFrames;
  const scale = frameScaleCoefficient * Math.log((totalFrames + frameScaleBase) / frameScaleBase);
  const performance = scale * Math.tanh((input.framesA - expectedFramesA) / performanceTanhDivisor);
  const bonus = input.framesA > totalFrames / 2 ? winBonusMultiplier * totalFrames
    : input.framesA < totalFrames / 2 ? -winBonusMultiplier * totalFrames
      : 0;

  return { probabilityA, expectedFramesA, scale, performance, bonus, deltaA: performance + bonus };
}