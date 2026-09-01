export type SnookerEloInput = {
  ratingA: number;
  ratingB: number;
  handicapA: number;
  framesA: number;
  framesB: number;
  /** The "500" in the frame-probability exponent. Larger values compress the probability gap
      produced by a given ELO difference. Defaults to the PDF spec's value. */
  handicapEloScale?: number;
    /** Legacy/display conversion. Match callers should pass handicapEloPerPoint from the
      rating-sensitive handicap curve; this remains as a backward-compatible fallback. */
  handicapPointsToElo?: number;
  /** ELO value of one applied handicap point for this match. */
  handicapEloPerPoint?: number;
  /** How much of the handicap's ELO-equivalent actually offsets the underlying rating gap, from 0
      (handicap has no effect on the odds) to 1 (a "fair" handicap makes the match exactly 50/50,
      the PDF's default). Below 1, a bigger ELO gap leaves a proportionally bigger residual edge for
      the stronger player even when the recommended handicap is applied — a fixed points head start
      does not fully cancel a real skill gap over one match. */
  handicapEffectiveness?: number;
  /** Residual handicap points around a fair game that retain the ordinary linear conversion. */
  excessHandicapSoftZone?: number;
  /** Point scale of the quadratic tail beyond the soft zone. Smaller values make an excessive
      handicap become decisive sooner. */
  excessHandicapCurveScale?: number;
  /** ELO sensitivity applied to the frame-share performance gap. Defaults to 250. */
  frameScaleCoefficient?: number;
  /** The "15" added to n in the logarithmic scaling factor. */
  frameScaleNumeratorOffset?: number;
  /** The "10" dividing the logarithmic scaling factor. */
  frameScaleDenominator?: number;
  /** The "3" multiplying the adaptive compression width. */
  compressionWidthBase?: number;
  /** The "0.1" in 10^(-0.1/n). */
  compressionWidthExponent?: number;
  /** The "2" in the repetition decay factor 2^(-t/7). */
  repetitionDecayBase?: number;
  /** The "7" in the repetition decay factor 2^(-t/7). */
  repetitionDecayPeriod?: number;
  /** Number of prior meetings between the players in the preceding 30 days. */
  repetitionCount?: number;
};

export type SnookerEloResult = {
  probabilityA: number;
  expectedFramesA: number;
  scale: number;
  compressionWidth: number;
  repetitionFactor: number;
  actualFrameShare: number;
  confidence: number;
  performance: number;
  bonus: number;
  deltaA: number;
};

export function calculateSnookerElo(input: SnookerEloInput): SnookerEloResult {
  const handicapEloScale = input.handicapEloScale ?? 500;
  const handicapEloPerPoint = input.handicapEloPerPoint ?? input.handicapPointsToElo ?? 25;
  const handicapEffectiveness = input.handicapEffectiveness ?? 1;
  const excessHandicapSoftZone = Math.max(0, input.excessHandicapSoftZone ?? 5);
  const excessHandicapCurveScale = Math.max(1, input.excessHandicapCurveScale ?? 26.5);
  const frameScaleCoefficient = input.frameScaleCoefficient ?? 250;
  const compressionWidthBase = input.compressionWidthBase ?? 3;
  const compressionWidthExponent = input.compressionWidthExponent ?? .1;
  const repetitionDecayBase = input.repetitionDecayBase ?? 2;
  const repetitionDecayPeriod = input.repetitionDecayPeriod ?? 7;
  const repetitionCount = Math.max(0, input.repetitionCount ?? 0);
  const handicapElo = handicapEffectiveness * handicapEloPerPoint * input.handicapA;
  const linearGap = input.ratingA - input.ratingB + handicapElo;
  // A fair handicap still lands exactly at 50/50. Once the residual advantage passes five
  // handicap points, a quadratic log-odds tail represents the practical scoring ceiling of a
  // snooker frame. This is symmetric: an excessive start hurts either player equally.
  const residualPoints = linearGap / handicapEloPerPoint;
  const excessPoints = Math.max(0, Math.abs(residualPoints) - excessHandicapSoftZone);
  const curvedLogOdds = linearGap / handicapEloScale
    + Math.sign(linearGap) * (excessPoints / excessHandicapCurveScale) ** 2;
  const probabilityA = 1 / (1 + 10 ** (-curvedLogOdds));

  const totalFrames = input.framesA + input.framesB;
  if (totalFrames <= 0) {
    // The match form previews odds before a score is entered. Preserve the rating and handicap
    // forecast there, while still preventing a zero-length match from changing either rating.
    return { probabilityA, expectedFramesA: 0, scale: frameScaleCoefficient, compressionWidth: compressionWidthBase,
      actualFrameShare: .5, confidence: 0,
      repetitionFactor: 1, performance: 0, bonus: 0, deltaA: 0 };
  }

  const expectedFramesA = probabilityA * totalFrames;
  const actualFrameShare = input.framesA / totalFrames;
  const confidence = totalFrames / (totalFrames + 5);
  const scale = frameScaleCoefficient;
  const compressionWidth = compressionWidthBase * 10 ** (-compressionWidthExponent / totalFrames);
  const repetitionFactor = repetitionDecayBase ** (-repetitionCount / repetitionDecayPeriod);
  const performance = scale * (actualFrameShare - probabilityA) * confidence * repetitionFactor;
  const bonus = 0;

  return { probabilityA, expectedFramesA, scale, compressionWidth, repetitionFactor, actualFrameShare, confidence, performance, bonus, deltaA: performance };
}
