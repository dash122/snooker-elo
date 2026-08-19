export function resolveOnboardingRating({
  currentRating,
  hasHistoricMatches,
  finalRating,
}: {
  currentRating: number | null | undefined;
  hasHistoricMatches: boolean;
  finalRating: number;
}) {
  if (hasHistoricMatches) {
    return {
      shouldOverrideCurrentRating: false,
      rating: currentRating ?? finalRating,
      initialRating: currentRating ?? finalRating,
      preliminaryRating: finalRating,
    };
  }

  return {
    shouldOverrideCurrentRating: true,
    rating: finalRating,
    initialRating: finalRating,
    preliminaryRating: finalRating,
  };
}
