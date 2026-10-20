import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3';

import { FlowData } from '~/flow/flow-data';

import { BoxPosition } from './box-line-layout';
import { BoxNode } from './models';

export const BOX_SIZE = 38;

const distance = (a: BoxPosition, b: BoxPosition): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function overlaps(a: BoxPosition, b: BoxPosition): boolean {
  return (
    Math.abs(a.x - b.x) < BOX_SIZE - 1e-6 &&
    Math.abs(a.y - b.y) < BOX_SIZE - 1e-6
  );
}

/** Nearest free box-sized cell; occupied cells never displace a fixed anchor. */
export function boxDropPosition(
  desired: BoxPosition,
  occupied: BoxPosition[],
  grid: boolean,
): BoxPosition {
  const start = grid
    ? {
        x: Math.round(desired.x / BOX_SIZE) * BOX_SIZE,
        y: Math.round(desired.y / BOX_SIZE) * BOX_SIZE,
      }
    : desired;
  const free = (p: BoxPosition): boolean =>
    !occupied.some((q) => overlaps(p, q));
  if (free(start)) return start;
  if (!grid) {
    const touching = occupied
      .flatMap((p) => [
        { x: p.x - BOX_SIZE, y: desired.y },
        { x: p.x + BOX_SIZE, y: desired.y },
        { x: desired.x, y: p.y - BOX_SIZE },
        { x: desired.x, y: p.y + BOX_SIZE },
      ])
      .filter(free)
      .sort((a, b) => distance(a, desired) - distance(b, desired));
    return touching[0];
  }
  for (let radius = 1; ; radius++) {
    const candidates: BoxPosition[] = [];
    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
        const p = { x: start.x + x * BOX_SIZE, y: start.y + y * BOX_SIZE };
        if (free(p)) candidates.push(p);
      }
    }
    if (candidates.length)
      return candidates.sort(
        (a, b) => distance(a, desired) - distance(b, desired),
      )[0];
  }
}

/** Soft attraction follows the chosen ELK layout; no dense rectangle is imposed. */
export function spaceBoxLayout(
  boxes: BoxNode[],
  flow: FlowData,
  pins: Map<string, BoxPosition>,
  grid: boolean,
  compact: boolean,
): void {
  if ((!grid && !compact) || !boxes.length) return;
  const occupied: BoxPosition[] = [];
  for (const box of boxes) {
    const pin = pins.get(box.id);
    if (!pin) continue;
    const p = boxDropPosition(pin, occupied, grid);
    pins.set(box.id, p);
    box.x = p.x;
    box.y = p.y;
    occupied.push(p);
  }

  if (compact) {
    const cx = boxes.reduce((sum, b) => sum + (b.x ?? 0), 0) / boxes.length;
    const cy = boxes.reduce((sum, b) => sum + (b.y ?? 0), 0) / boxes.length;
    const nodes = boxes.map((b) => ({
      id: b.id,
      x: b.x ?? 0,
      y: b.y ?? 0,
      ...(pins.has(b.id) ? { fx: b.x, fy: b.y } : {}),
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const links = flow.links
      .filter(
        (l) => l.source !== l.target && ids.has(l.source) && ids.has(l.target),
      )
      .map((l) => ({ source: l.source, target: l.target }));
    const simulation = forceSimulation(nodes)
      .stop()
      .force(
        'links',
        forceLink(links)
          .id((n) => (n as (typeof nodes)[number]).id)
          .distance(BOX_SIZE)
          .strength(0.7),
      )
      .force('charge', forceManyBody().strength(-BOX_SIZE * 1.5))
      .force('x', forceX(cx).strength(0.035))
      .force('y', forceY(cy).strength(0.035));
    for (let tick = 0; tick < 240; tick++) {
      simulation.tick();
      // Square collision keeps edge-to-edge contact possible, unlike circles.
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          if (!overlaps(a, b)) continue;
          const axis = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y';
          const delta =
            (BOX_SIZE - Math.abs(a[axis] - b[axis])) *
            (a[axis] <= b[axis] ? -1 : 1);
          const fixedA = pins.has(a.id),
            fixedB = pins.has(b.id);
          if (!fixedA) a[axis] += delta * (fixedB ? 1 : 0.5);
          if (!fixedB) b[axis] -= delta * (fixedA ? 1 : 0.5);
        }
    }
    nodes.forEach((n, i) => {
      boxes[i].x = n.x;
      boxes[i].y = n.y;
    });
  }
  // Quantization can merge nearby nodes, so allocate anchors first, then hubs.
  const degree: Record<string, number> = Object.fromEntries(
    boxes.map((b) => [b.id, 0]),
  );
  flow.links.forEach((l) => {
    degree[l.source] = (degree[l.source] ?? 0) + 1;
    degree[l.target] = (degree[l.target] ?? 0) + 1;
  });
  const freeBoxes = boxes
    .filter((b) => !pins.has(b.id))
    .sort((a, b) => degree[b.id] - degree[a.id] || a.id.localeCompare(b.id));
  for (const box of freeBoxes) {
    const p = boxDropPosition({ x: box.x ?? 0, y: box.y ?? 0 }, occupied, grid);
    box.x = p.x;
    box.y = p.y;
    occupied.push(p);
  }
}
