export type SnookerEloInput = {
  ratingA: number;
  ratingB: number;
  handicapA: number;
  framesA: number;
  framesB: number;
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
  const totalFrames = input.framesA + input.framesB;
  if (totalFrames <= 0) {
    return { probabilityA: .5, expectedFramesA: 0, scale: 0, performance: 0, bonus: 0, deltaA: 0 };
  }

  const probabilityA = 1 / (1 + 10 ** (-(input.ratingA - input.ratingB + 25 * input.handicapA) / 500));
  const expectedFramesA = probabilityA * totalFrames;
  const scale = 150 * Math.log((totalFrames + 10) / 10);
  const performance = scale * Math.tanh((input.framesA - expectedFramesA) / 3);
  const bonus = input.framesA > totalFrames / 2 ? 2 * totalFrames
    : input.framesA < totalFrames / 2 ? -2 * totalFrames
      : 0;

  return { probabilityA, expectedFramesA, scale, performance, bonus, deltaA: performance + bonus };
}