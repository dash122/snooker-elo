export function resolveOnboardingRating(params: {
  currentRating: number | null | undefined;
  initialRating: number | null | undefined;
  hasHistoricMatches: boolean;
  finalRating: number;
}) {
  const { finalRating } = params;
  return {
    shouldOverrideCurrentRating: true,
    rating: finalRating,
    initialRating: finalRating,
    preliminaryRating: finalRating,
  };
}
