import { parseRecipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';

import { isPhysicalRecipe, wholeMachineScale } from './whole-machines';

describe('exact whole-machine ratios', () => {
  it('finds the smallest common scale, including non-integer scale factors', () => {
    const counts = [rational(12, 5), rational(18, 5)];
    const scale = wholeMachineScale(counts);
    expect(scale).toEqual(rational(5, 3));
    expect(counts.map((c) => c.mul(scale))).toEqual([rational(4), rational(6)]);
    expect(wholeMachineScale([rational(6), rational(9)])).toEqual(rational.one);
    expect(wholeMachineScale([rational.zero])).toEqual(rational.one);
  });

  it('preserves the CSV example exactly instead of rounding 222.17 furnaces to 223', () => {
    // Manufacturing counts from the supplied FactorioLab export. Mining and
    // pumping are outside the unlimited-primary-resource boundary.
    const counts = [
      '7',
      '20/3',
      '10/3',
      '10/3',
      '5/8',
      '20/3',
      '15',
      '7',
      '5/3',
      '5',
      '5/2',
      '5/4',
      '12',
      '6',
      '1/2',
      '1/4',
      '37',
      '5/12',
      '5',
      '3/2',
      '1/2',
      '4',
      '1/2',
      '65/48',
      '65/6',
      '5',
      '15',
      '40/3',
      '4/3',
      '20665/1872',
      '5665/1872',
      '23/12',
      '86/3',
      '245/2',
      '159',
      '1333/6',
      '50/3',
      '3125/234',
    ].map((c) => rational(c));
    const scale = wholeMachineScale(counts);
    expect(scale).toEqual(rational(1872));
    expect(counts.every((c) => c.mul(scale).isInteger())).toBeTrue();
    expect(rational(1333, 6).mul(scale)).toEqual(rational(415896));
    // Any smaller integer scale fails at least one recipe. Science objectives
    // include coprime counts 5 and 6, so valid scales must be integers.
    for (let s = 1; s < 1872; s++)
      expect(counts.some((c) => !c.mul(rational(s)).isInteger())).toBeTrue();
  });

  it('excludes virtual, launch, and percentage rates from machine constraints', () => {
    const recipe = parseRecipe({
      id: 'test',
      name: 'Test',
      time: 1,
      in: {},
      out: {},
      producers: ['assembler'],
    });
    expect(isPhysicalRecipe(recipe)).toBeTrue();
    expect(isPhysicalRecipe({ ...recipe, producers: undefined })).toBeFalse();
    expect(isPhysicalRecipe({ ...recipe, part: 'rocket-part' })).toBeFalse();
    expect(
      isPhysicalRecipe({ ...recipe, flags: new Set(['infinite']) }),
    ).toBeFalse();
  });
});
