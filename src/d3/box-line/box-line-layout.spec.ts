import { TestBed } from '@angular/core/testing';
import ELK from 'elkjs';

import { FlowData } from '~/flow/flow-data';
import { Mocks } from '~/tests/mocks/mocks';
import { TestModule } from '~/tests/test-module';

import { boxViewBox, createBoxGraph, restoreBoxPins } from './box-line-layout';
import { BoxNode } from './models';

describe('box-line pinned layout', () => {
  let flow: FlowData;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestModule] });
    flow = TestBed.inject(Mocks).flow();
  });

  for (const algorithm of ['layered', 'force', 'stress'] as const) {
    it(`keeps multiple pins exact through a real ELK ${algorithm} layout`, async () => {
      const pins = new Map([
        ['r|0', { x: -100, y: 50 }],
        ['r|1', { x: 180, y: 125 }],
      ]);
      for (const seed of [1, 2]) {
        const graph = createBoxGraph(flow, algorithm, new Map(), pins, seed);
        expect(graph.layoutOptions?.['elk.algorithm']).toEqual(algorithm);
        const result = await new ELK().layout(graph);
        const boxes = result.children as BoxNode[];
        restoreBoxPins(boxes, flow, pins);
        for (const [id, position] of pins) {
          expect(boxes.find((b) => b.id === id)?.x).toEqual(position.x);
          expect(boxes.find((b) => b.id === id)?.y).toEqual(position.y);
        }
        expect(
          boxes.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)),
        ).toBeTrue();
      }
    });
  }

  it('keeps material links sharing endpoints distinct for every algorithm', async () => {
    const data = { ...flow, links: [...flow.links, { ...flow.links[0] }] };
    for (const algorithm of ['layered', 'force', 'stress'] as const) {
      const graph = createBoxGraph(data, algorithm, new Map(), new Map(), 1);
      expect(new Set(graph.edges.map((e) => e.id)).size).toEqual(
        data.links.length,
      );
      const result = await new ELK().layout(graph);
      expect(result.children?.length).toEqual(flow.nodes.length);
    }
  });

  it('changes the free starting positions without disturbing pin coordinates', () => {
    const pins = new Map([['r|0', { x: 100, y: 200 }]]);
    const positions = new Map([['r|1', { x: 250, y: 300 }]]);
    const first = createBoxGraph(flow, 'stress', positions, pins, 1);
    const second = createBoxGraph(flow, 'stress', positions, pins, 2);
    expect(first.children[0].x).toEqual(second.children[0].x);
    expect(first.children[0].y).toEqual(second.children[0].y);
    expect(first.children[1].x).not.toEqual(second.children[1].x);
    expect(first.children[1].y).not.toEqual(second.children[1].y);
  });

  it('preserves the selected algorithm when no boxes are pinned', () => {
    const graph = createBoxGraph(flow, 'force', new Map(), new Map(), 2);
    expect(graph.layoutOptions?.['elk.algorithm']).toEqual('force');
    expect(graph.children.every((b) => b.x == null && b.y == null)).toBeTrue();
  });

  it('restores pins in disconnected components independently', () => {
    const boxes = flow.nodes.map((n, i) => ({ ...n, x: i * 100, y: 0 }));
    const pins = new Map([
      ['r|0', { x: -50, y: -75 }],
      ['r|1', { x: 200, y: 300 }],
    ]);
    restoreBoxPins(boxes, { ...flow, links: [] }, pins);
    expect(boxes[0].x).toEqual(-50);
    expect(boxes[0].y).toEqual(-75);
    expect(boxes[1].x).toEqual(200);
    expect(boxes[1].y).toEqual(300);
    expect(boxes[2].x).toEqual(200);
  });

  it('includes negative coordinates and empty layouts in the view box', () => {
    const boxes = [
      { ...flow.nodes[0], x: -100, y: -50, width: 38, height: 38 },
    ];
    expect(boxViewBox(boxes)).toEqual('-120 -70 78 78');
    expect(boxViewBox([])).toEqual('0 0 1 1');
    expect(boxViewBox(flow.nodes)).toEqual('-20 -20 78 78');
  });

  it('handles missing positions and dangling links without producing NaN', () => {
    const boxes: BoxNode[] = flow.nodes.map((n) => ({ ...n }));
    const pins = new Map([['r|0', { x: 10, y: 20 }]]);
    const withDanglingLink = {
      ...flow,
      links: [
        ...flow.links,
        { ...flow.links[0], source: 'r|0', target: 'missing' },
      ],
    };
    restoreBoxPins(boxes, withDanglingLink, pins);
    expect(boxes.every((b) => b.x === 10 && b.y === 20)).toBeTrue();
  });
});
