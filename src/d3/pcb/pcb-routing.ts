import { BoxPosition } from '../box-line/box-line-layout';
import { boxDropPosition } from '../box-line/box-line-spacing';
import { BoxEdge, BoxNode } from '../box-line/models';
import { num } from '../helpers';

export type Point = [number, number];
const STEP = 9.5;
const DIRECTIONS: Point[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const key = (x: number, y: number): string => `${x},${y}`;
const segment = (a: Point, b: Point): string =>
  [key(...a), key(...b)].sort().join('|');

/** Reserve a box-width channel between footprints, including pinned footprints. */
export function pcbDropPosition(
  desired: BoxPosition,
  occupied: BoxPosition[],
): BoxPosition {
  const p = boxDropPosition(
    { x: desired.x / 2, y: desired.y / 2 },
    occupied.map((q) => ({ x: q.x / 2, y: q.y / 2 })),
    true,
  );
  return { x: p.x * 2, y: p.y * 2 };
}

export function placePcbBoxes(
  boxes: BoxNode[],
  pins: Map<string, BoxPosition>,
): void {
  const occupied: BoxPosition[] = [];
  const ordered = [
    ...boxes.filter((b) => pins.has(b.id)),
    ...boxes.filter((b) => !pins.has(b.id)),
  ];
  for (const box of ordered) {
    const p = pcbDropPosition(
      pins.get(box.id) ?? { x: num(box.x), y: num(box.y) },
      occupied,
    );
    box.x = p.x;
    box.y = p.y;
    occupied.push(p);
    if (pins.has(box.id)) pins.set(box.id, p);
  }
}

interface State {
  x: number;
  y: number;
  dir: number;
  cost: number;
  estimate: number;
  parent?: State;
  start: Point;
}
class Heap {
  private readonly items: State[] = [];
  get size(): number {
    return this.items.length;
  }
  push(value: State): void {
    let i = this.items.length;
    this.items.push(value);
    while (i) {
      const p = (i - 1) >> 1;
      if (this.items[p].estimate <= value.estimate) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = value;
  }
  pop(): State {
    const result = this.items[0],
      last = this.items[this.items.length - 1];
    this.items.length--;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].estimate < this.items[child].estimate
        )
          child++;
        if (this.items[child].estimate >= last.estimate) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return result;
  }
}

export interface PcbRoute {
  points: Point[];
  path: string;
}
export interface PcbMetrics {
  length: number;
  bends: number;
  crossings: number;
  shared: number;
  unrouted: number;
}
export interface PcbRouting {
  routes: Record<string, PcbRoute>;
  metrics: PcbMetrics;
}

export function tracePath(points: Point[], leftToRight = false): string {
  const result = [...points];
  if (
    leftToRight &&
    result.length > 1 &&
    (result[result.length - 1][0] < result[0][0] ||
      (result[result.length - 1][0] === result[0][0] &&
        result[result.length - 1][1] < result[0][1]))
  )
    result.reverse();
  return result.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
}

export function pcbViewBox(boxes: BoxNode[], routing: PcbRouting): string {
  const points: Point[] = boxes.flatMap(
    (b) =>
      [
        [num(b.x), num(b.y)],
        [num(b.x) + 38, num(b.y) + 38],
      ] as Point[],
  );
  Object.values(routing.routes).forEach((route) =>
    points.push(...route.points),
  );
  if (!points.length) return '0 0 1 1';
  const x = Math.min(...points.map((p) => p[0])) - 20,
    y = Math.min(...points.map((p) => p[1])) - 20;
  return `${x} ${y} ${Math.max(...points.map((p) => p[0])) - x + 20} ${Math.max(...points.map((p) => p[1])) - y + 20}`;
}

/** Offset orthogonal polylines without turning their corners into diagonal shortcuts. */
export function offsetTrace(points: Point[], offset: number): Point[] {
  return points.map(([x, y], i) => {
    const normal = (a: Point, b: Point): Point => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        d = Math.hypot(dx, dy);
      return d ? [-dy / d, dx / d] : [0, 0];
    };
    const before = normal(points[Math.max(0, i - 1)], points[i]);
    const after = normal(points[i], points[Math.min(points.length - 1, i + 1)]);
    const denominator = 1 + before[0] * after[0] + before[1] * after[1] || 1;
    return [
      x + (offset * (before[0] + after[0])) / denominator,
      y + (offset * (before[1] + after[1])) / denominator,
    ];
  });
}

/** Two candidate trace orders, with A* length, bend, crossing and congestion costs. */
export function routePcbTraces(
  boxes: BoxNode[],
  edges: BoxEdge[],
  searchLimit = 100000,
): PcbRouting {
  const blocked = new Set<string>();
  const centers = new Map<string, Point>();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const box of boxes) {
    const cx = Math.round((num(box.x) + 19) / STEP),
      cy = Math.round((num(box.y) + 19) / STEP);
    centers.set(box.id, [cx, cy]);
    minX = Math.min(minX, cx - 10);
    maxX = Math.max(maxX, cx + 10);
    minY = Math.min(minY, cy - 10);
    maxY = Math.max(maxY, cy + 10);
    for (let x = cx - 3; x <= cx + 3; x++)
      for (let y = cy - 3; y <= cy + 3; y++) blocked.add(key(x, y));
  }
  const ports = (center: Point): Point[] =>
    DIRECTIONS.map(
      ([dx, dy]): Point => [center[0] + dx * 4, center[1] + dy * 4],
    );
  const run = (order: BoxEdge[]): PcbRouting => {
    const routes: Record<string, PcbRoute> = {};
    const usage = new Map<string, number>(),
      axisUse = new Map<string, Set<number>>();
    const metrics: PcbMetrics = {
      length: 0,
      bends: 0,
      crossings: 0,
      shared: 0,
      unrouted: 0,
    };
    for (const edge of order) {
      const source = centers.get(edge.source),
        target = centers.get(edge.target);
      let points: Point[] = [];
      if (source && target) {
        const loop = edge.source === edge.target;
        const starts = ports(source).filter(
          (p, i) => (!loop || i === 0) && !blocked.has(key(...p)),
        );
        const goals = ports(target).filter(
          (p, i) => (!loop || i === 3) && !blocked.has(key(...p)),
        );
        const goalKeys = new Set(goals.map((p) => key(...p)));
        const heuristic = (x: number, y: number): number =>
          Math.min(
            ...goals.map((p) => Math.abs(x - p[0]) + Math.abs(y - p[1])),
          );
        const queue = new Heap(),
          best = new Map<string, number>();
        for (const start of starts)
          queue.push({
            x: start[0],
            y: start[1],
            dir: -1,
            cost: 0,
            estimate: heuristic(...start),
            start,
          });
        let visits = 0;
        while (queue.size && visits++ < searchLimit) {
          const current = queue.pop();
          const stateKey = `${key(current.x, current.y)},${current.dir}`;
          if (current.cost > (best.get(stateKey) ?? Infinity)) continue;
          if (goalKeys.has(key(current.x, current.y))) {
            const walk: Point[] = [];
            let state: State | undefined = current;
            while (state) {
              walk.push([state.x, state.y]);
              state = state.parent;
            }
            walk.reverse();
            const first = walk[0],
              last = walk[walk.length - 1];
            const startPort: Point = [
              (source[0] + (first[0] - source[0]) / 2) * STEP,
              (source[1] + (first[1] - source[1]) / 2) * STEP,
            ];
            const endPort: Point = [
              (target[0] + (last[0] - target[0]) / 2) * STEP,
              (target[1] + (last[1] - target[1]) / 2) * STEP,
            ];
            // Leave room for the directional arrow outside the destination footprint.
            endPort[0] += ((last[0] - target[0]) / 4) * 5;
            endPort[1] += ((last[1] - target[1]) / 4) * 5;
            points = [
              startPort,
              ...walk.map(([x, y]): Point => [x * STEP, y * STEP]),
              endPort,
            ];
            for (let i = 1; i < walk.length; i++) {
              const a = walk[i - 1],
                b = walk[i],
                k = segment(a, b),
                axis = Number(a[0] === b[0]);
              metrics.shared += Number(usage.has(k));
              usage.set(k, (usage.get(k) ?? 0) + 1);
              const axes = axisUse.get(key(...b)) ?? new Set<number>();
              metrics.crossings += Number(axes.has(1 - axis));
              axes.add(axis);
              axisUse.set(key(...b), axes);
            }
            break;
          }
          DIRECTIONS.forEach(([dx, dy], dir) => {
            const x = current.x + dx,
              y = current.y + dy;
            if (
              x < minX ||
              x > maxX ||
              y < minY ||
              y > maxY ||
              blocked.has(key(x, y))
            )
              return;
            const axis = dir % 2,
              occupied =
                usage.get(segment([current.x, current.y], [x, y])) ?? 0;
            const crossing = axisUse.get(key(x, y))?.has(1 - axis);
            const cost =
              current.cost +
              1 +
              Number(current.dir !== -1 && current.dir !== dir) * 0.6 +
              occupied * 8 +
              Number(crossing === true) * 3;
            const k = `${key(x, y)},${dir}`;
            if (cost >= (best.get(k) ?? Infinity)) return;
            best.set(k, cost);
            queue.push({
              x,
              y,
              dir,
              cost,
              estimate: cost + heuristic(x, y),
              parent: current,
              start: current.start,
            });
          });
        }
      }
      // Remove straight interior vertices; labels and parallel belts follow the same centerline.
      const simplified = points.filter(
        (p, i) =>
          i === 0 ||
          i === points.length - 1 ||
          (p[0] - points[i - 1][0]) * (points[i + 1][1] - p[1]) !==
            (p[1] - points[i - 1][1]) * (points[i + 1][0] - p[0]),
      );
      for (let i = 1; i < simplified.length; i++)
        metrics.length += Math.hypot(
          simplified[i][0] - simplified[i - 1][0],
          simplified[i][1] - simplified[i - 1][1],
        );
      metrics.bends += Math.max(0, simplified.length - 2);
      metrics.unrouted += Number(!simplified.length);
      routes[edge.id] = { points: simplified, path: tracePath(simplified) };
    }
    return { routes, metrics };
  };
  const order = [...edges].sort(
    (a, b) => num(b.beltCount) - num(a.beltCount) || a.id.localeCompare(b.id),
  );
  const first = run(order),
    second = run([...order].reverse());
  const score = ({ metrics: m }: PcbRouting): number =>
    m.unrouted * 1e9 +
    m.length +
    m.bends * STEP * 0.6 +
    m.crossings * STEP * 3 +
    m.shared * STEP * 8;
  return score(second) < score(first) ? second : first;
}
