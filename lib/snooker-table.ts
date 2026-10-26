/** Metres. Visual approximation: official pocket cuts are defined by templates,
 * not one universal diameter. Corner radius produces a ~86 mm diagonal mouth;
 * the middle pocket has a ~90 mm mouth, versus a 52.5 mm ball.
 */
export const TABLE_POCKETS = {
  cornerCut: .061,
  middleCut: .045,
  leatherWidth: .013,
  leatherHeight: .009,
};
export function pocketCut(z:number) {
  return z===0?TABLE_POCKETS.middleCut:TABLE_POCKETS.cornerCut;
}
