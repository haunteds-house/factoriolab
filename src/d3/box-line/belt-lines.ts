import { curveBasis, curveLinear, curveNatural, line } from 'd3';

import { num } from '../helpers';
import { offsetTrace, Point } from '../pcb/pcb-routing';
import { getArcPoint } from './box-line-edge';
import { BoxEdge } from './models';

/** One SVG path keeps even large belt counts from creating thousands of DOM nodes. */
export function beltLines(
  edge: BoxEdge,
  routedPoints?: Point[],
): {
  path: string;
  width: number;
  multiplier: number;
  span: number;
} {
  const count = edge.beltCount ?? 0;
  // Extremely large factories still render promptly; grouping is always labelled.
  const multiplier = Math.max(1, Math.ceil(count / 4096));
  const lanes = Math.ceil(count / multiplier);
  const gap = lanes > 1 ? Math.min(3, 24 / (lanes - 1)) : 3;
  const source: [number, number] = [
    num(edge.sourceNode.x) + num(edge.sourceNode.width) / 2,
    num(edge.sourceNode.y) + num(edge.sourceNode.height) / 2,
  ];
  const target: [number, number] = [
    num(edge.targetNode.x) + num(edge.targetNode.width) / 2,
    num(edge.targetNode.y) + num(edge.targetNode.height) / 2,
  ];
  const dx = target[0] - source[0],
    dy = target[1] - source[1];
  const length = Math.hypot(dx, dy);
  const normal = length ? [-dy / length, dx / length] : [0, 1];
  let points = [source, target];
  const generator = line();
  if (edge.sourceNode === edge.targetNode) {
    const size = Math.max(
      num(edge.sourceNode.width),
      num(edge.sourceNode.height),
    );
    points = [
      source,
      [source[0] + size, source[1] - size],
      [source[0] - size, source[1] - size],
      target,
    ];
    generator.curve(curveBasis);
  } else if (edge.bidi) {
    points = [source, getArcPoint(source, target, edge.sourceNode), target];
    generator.curve(curveNatural);
  }
  if (routedPoints) {
    points = routedPoints;
    generator.curve(curveLinear);
  }
  const width = Math.min(1.5, gap * 0.55);
  return {
    span: lanes ? (lanes - 1) * gap + width : 0,
    path: Array.from({ length: lanes }, (_, i) => {
      const offset = (i - (lanes - 1) / 2) * gap;
      if (routedPoints) return generator(offsetTrace(points, offset));
      return generator(
        points.map(([x, y]): [number, number] => [
          x + normal[0] * offset,
          y + normal[1] * offset,
        ]),
      );
    }).join(''),
    width,
    multiplier,
  };
}
