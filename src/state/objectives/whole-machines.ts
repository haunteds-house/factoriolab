import { Recipe } from '~/data/schema/recipe';
import { gcd, Rational, rational } from '~/rational/rational';

export const PRIMARY_RESOURCES = [
  'iron-ore',
  'copper-ore',
  'stone',
  'coal',
  'water',
  'crude-oil',
];

/** Launch rates and percentages do not represent buildable machines. */
export function isPhysicalRecipe(recipe: Recipe): boolean {
  return (
    !!recipe.producers?.length && !recipe.part && !recipe.flags.has('infinite')
  );
}

/**
 * For counts p_i/q_i, every valid common scale is a multiple of
 * lcm(q_i)/gcd(p_i). Choose its first multiple >= 1, without float rounding.
 * This is the minimum uniform expansion of the selected production plan.
 */
export function wholeMachineScale(counts: Rational[]): Rational {
  let denominator = 1n;
  let numerator = 0n;
  for (const count of counts) {
    if (!count.gt(rational.zero)) continue;
    denominator = (denominator / gcd(denominator, count.q)) * count.q;
    numerator = gcd(numerator, count.p);
  }
  if (!numerator) return rational.one;
  const increment = new Rational(denominator, numerator);
  return increment.mul(increment.reciprocal().ceil());
}
