import { beltLines } from '../box-line/belt-lines';
import { BoxEdge, BoxNode } from '../box-line/models';
import {
  offsetTrace,
  pcbDropPosition,
  pcbViewBox,
  placePcbBoxes,
  Point,
  routePcbTraces,
  tracePath,
} from './pcb-routing';

function box(id: string, x = 0, y = 0): BoxNode {
  return { id, x, y, width: 38, height: 38 } as BoxNode;
}
function edge(
  a: BoxNode,
  b: BoxNode,
  id = 'edge',
  beltCount?: number,
): BoxEdge {
  return {
    id,
    source: a.id,
    target: b.id,
    sourceNode: a,
    targetNode: b,
    beltCount,
  } as BoxEdge;
}
function assertRoute(points: Point[], obstacles: BoxNode[]): void {
  expect(points.length).toBeGreaterThan(1);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    expect(a[0] === b[0] || a[1] === b[1]).toBeTrue();
    expect([...a, ...b].every(Number.isFinite)).toBeTrue();
    for (const n of obstacles) {
      const x = n.x ?? 0,
        y = n.y ?? 0;
      const crosses =
        a[0] === b[0]
          ? a[0] > x &&
            a[0] < x + 38 &&
            Math.max(a[1], b[1]) > y &&
            Math.min(a[1], b[1]) < y + 38
          : a[1] > y &&
            a[1] < y + 38 &&
            Math.max(a[0], b[0]) > x &&
            Math.min(a[0], b[0]) < x + 38;
      expect(crosses).toBeFalse();
    }
  }
}

describe('PCB placement and trace routing', () => {
  it('reserves channels, aligns pins once and prevents footprint overlaps', () => {
    const boxes = [box('a', 1, -10), box('b', 5, 8), box('c', 1, -10)];
    const pins = new Map([['c', { x: 1, y: -10 }]]);
    placePcbBoxes(boxes, pins);
    expect(pins.get('c')?.x).toBeCloseTo(0);
    expect(pins.get('c')?.y).toBeCloseTo(0);
    expect(new Set(boxes.map((b) => `${b.x ?? 0},${b.y ?? 0}`)).size).toEqual(
      3,
    );
    boxes.forEach((b) => {
      expect((b.x ?? 0) % 76).toBeCloseTo(0);
      expect((b.y ?? 0) % 76).toBeCloseTo(0);
    });
    const pinned = pins.get('c');
    placePcbBoxes(boxes, pins);
    expect(pins.get('c')).toEqual(pinned);
    expect(pcbDropPosition({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).not.toEqual({
      x: 0,
      y: 0,
    });
    placePcbBoxes([{ id: 'missing' } as BoxNode], new Map());
  });

  it('routes horizontal, vertical and diagonal connections around obstacles in all directions', () => {
    const source = box('source', 0, 0);
    for (const [x, y] of [
      [228, 0],
      [-228, 0],
      [0, 228],
      [0, -228],
      [228, 228],
      [-228, -228],
      [228, -228],
      [-228, 228],
    ]) {
      const target = box('target', x, y),
        obstacle = box('obstacle', x / 3, y / 3);
      const result = routePcbTraces(
        [source, target, obstacle],
        [edge(source, target)],
      );
      expect(result.metrics.unrouted).toEqual(0);
      assertRoute(result.routes['edge'].points, [obstacle]);
      expect(result.metrics.length).toBeGreaterThan(0);
      expect(result.routes['edge'].path).not.toContain('NaN');
    }
  });

  it('routes self-loops around their own footprint and includes detours in bounds', () => {
    const source = box('source');
    const result = routePcbTraces([source], [edge(source, source)]);
    expect(result.metrics.unrouted).toEqual(0);
    assertRoute(result.routes['edge'].points, []);
    expect(result.metrics.bends).toBeGreaterThan(1);
    const [x, y, w, h] = pcbViewBox([source], result).split(' ').map(Number);
    expect(y).toBeLessThan(-20);
    expect(x + w).toBeGreaterThan(38);
    expect(y + h).toBeGreaterThan(38);
    expect(pcbViewBox([], routePcbTraces([], []))).toEqual('0 0 1 1');
    expect(
      pcbViewBox([{ id: 'missing' } as BoxNode], routePcbTraces([], [])),
    ).toEqual('-20 -20 78 78');
  });

  it('optimizes congested multi-net layouts and retains every net', () => {
    const boxes = Array.from({ length: 16 }, (_, i) =>
      box(String(i), (i % 4) * 76, Math.floor(i / 4) * 76),
    );
    const edges = boxes.flatMap((b, i) => [
      edge(b, boxes[(i + 7) % 16], `${i}-a`, i + 1),
      edge(b, boxes[(i + 9) % 16], `${i}-b`, i + 1),
    ]);
    const result = routePcbTraces(boxes, edges);
    expect(Object.keys(result.routes).length).toEqual(edges.length);
    expect(result.metrics.unrouted).toEqual(0);
    edges.forEach((e) => {
      assertRoute(
        result.routes[e.id].points,
        boxes.filter((b) => b !== e.sourceNode && b !== e.targetNode),
      );
    });
    expect(result.metrics.bends).toBeGreaterThan(0);
    expect(result.metrics.crossings + result.metrics.shared).toBeGreaterThan(0);
    // Repeated solves are reproducible.
    expect(routePcbTraces(boxes, edges).metrics).toEqual(result.metrics);
  });

  it('reports unreachable or budget-limited nets without drawing through obstacles', () => {
    const a = box('a'),
      b = box('b', 152, 0);
    expect(routePcbTraces([a, b], [edge(a, b)], 0).metrics.unrouted).toEqual(1);
    const walls = [
      box('right', 38, 0),
      box('left', -38, 0),
      box('up', 0, -38),
      box('down', 0, 38),
    ];
    expect(
      routePcbTraces([a, b, ...walls], [edge(a, b)]).metrics.unrouted,
    ).toEqual(1);
    expect(routePcbTraces([], [edge(a, b)]).routes['edge'].points).toEqual([]);
    expect(
      routePcbTraces([{ id: 'missing' } as BoxNode], []).metrics.length,
    ).toEqual(0);
  });

  it('offsets orthogonal belt traces, handles degenerate points and reverses labels safely', () => {
    const points: Point[] = [
      [0, 0],
      [38, 0],
      [38, 76],
    ];
    expect(offsetTrace(points, 3)).toEqual([
      [0, 3],
      [35, 3],
      [35, 76],
    ]);
    expect(
      offsetTrace(
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
        1,
      )
        .flat()
        .every(Number.isFinite),
    ).toBeTrue();
    expect(offsetTrace([[0, 0]], 1)).toEqual([[0, 0]]);
    expect(tracePath([])).toEqual('');
    expect(
      tracePath(
        [
          [10, 0],
          [0, 0],
        ],
        true,
      ),
    ).toEqual('M0,0L10,0');
    expect(
      tracePath(
        [
          [0, 10],
          [0, 0],
        ],
        true,
      ),
    ).toEqual('M0,0L0,10');
    expect(
      tracePath(
        [
          [0, 0],
          [0, 10],
        ],
        true,
      ),
    ).toEqual('M0,0L0,10');
    const result = beltLines(
      edge(box('a'), box('b', 76, 76), 'belt', 3),
      points,
    );
    expect(result.path.match(/M/g)?.length).toEqual(3);
    expect(result.path).not.toContain('C');
  });
});
