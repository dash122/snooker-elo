export function resolveOnboardingRating({
  currentRating,
  initialRating,
  hasHistoricMatches,
  finalRating,
}: {
  currentRating: number | null | undefined;
  initialRating: number | null | undefined;
  hasHistoricMatches: boolean;
  finalRating: number;
}) {
  return {
    shouldOverrideCurrentRating: true,
    rating: finalRating,
    initialRating: finalRating,
    preliminaryRating: finalRating,
  };
}
