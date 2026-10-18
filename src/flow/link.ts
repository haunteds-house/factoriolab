import { Rational } from '~/rational/rational';

import { BaseData } from './base-data';

export interface Link extends BaseData {
  source: string;
  target: string;
  value: number;
  /** Whole physical belts for this individual flow, rounded up exactly. Fluids omit this. */
  beltCount?: number;
  /** Material and exact share of its total rate, retained through node simplification. */
  itemId?: string;
  share?: Rational;
  description?: string;
  // Bidirectional link between two nodes
  bidi?: boolean;
}
