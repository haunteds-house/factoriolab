import { TestBed } from '@angular/core/testing';
import ELK from 'elkjs';

import { FlowData } from '~/flow/flow-data';
import { Mocks } from '~/tests/mocks/mocks';
import { TestModule } from '~/tests/test-module';

import { BoxPosition, createBoxGraph, restoreBoxPins } from './box-line-layout';
import { BOX_SIZE, boxDropPosition, spaceBoxLayout } from './box-line-spacing';
import { BoxNode } from './models';

describe('box-line spacing', () => {
  let flow: FlowData;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestModule] });
    flow = TestBed.inject(Mocks).flow();
  });

  function assertSeparated(boxes: BoxNode[], grid: boolean): void {
    boxes.forEach((a, i) => {
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBeTrue();
      if (grid) {
        expect((a.x ?? 0) / BOX_SIZE).toEqual(
          Math.round((a.x ?? 0) / BOX_SIZE),
        );
        expect((a.y ?? 0) / BOX_SIZE).toEqual(
          Math.round((a.y ?? 0) / BOX_SIZE),
        );
      }
      boxes.slice(i + 1).forEach((b) => {
        expect(
          Math.abs((a.x ?? 0) - (b.x ?? 0)) >= BOX_SIZE - 1e-6 ||
            Math.abs((a.y ?? 0) - (b.y ?? 0)) >= BOX_SIZE - 1e-6,
        ).toBeTrue();
      });
    });
  }

  it('leaves the layout alone by default and accepts an empty graph', () => {
    const boxes = flow.nodes.map((n, i) => ({ ...n, x: i * 17, y: i * 11 }));
    const before = boxes.map((b) => ({ ...b }));
    spaceBoxLayout(boxes, flow, new Map(), false, false);
    expect(boxes).toEqual(before);
    spaceBoxLayout([], flow, new Map(), true, true);
  });

  it('snaps negative positions and finds an open cell beyond a filled ring', () => {
    expect(boxDropPosition({ x: -45, y: 20 }, [], true)).toEqual({
      x: -38,
      y: 38,
    });
    const occupied: BoxPosition[] = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++) occupied.push({ x: x * 38, y: y * 38 });
    const result = boxDropPosition({ x: 0, y: 0 }, occupied, true);
    expect(Math.max(Math.abs(result.x), Math.abs(result.y))).toEqual(76);
    expect(boxDropPosition({ x: 1, y: 2 }, [], false)).toEqual({ x: 1, y: 2 });
    const touching = boxDropPosition({ x: 3, y: 2 }, [{ x: 0, y: 0 }], false);
    expect(touching).toEqual({ x: 38, y: 2 });
  });

  for (const algorithm of ['layered', 'force', 'stress'] as const) {
    it(`combines grid and compaction after ${algorithm}, keeping snapped pins stable`, async () => {
      const pins = new Map([
        ['r|0', { x: -115, y: 43 }],
        ['r|1', { x: -115, y: 43 }],
      ]);
      for (const seed of [1, 2]) {
        const result = await new ELK().layout(
          createBoxGraph(flow, algorithm, new Map(), pins, seed),
        );
        const boxes = result.children as BoxNode[];
        restoreBoxPins(boxes, flow, pins);
        const before = seed === 2 ? new Map(pins) : undefined;
        spaceBoxLayout(boxes, flow, pins, true, true);
        assertSeparated(boxes, true);
        for (const [id, position] of pins) {
          const box = boxes.find((b) => b.id === id);
          expect({ x: box?.x, y: box?.y }).toEqual(position);
        }
        if (before) expect(pins).toEqual(before);
      }
    });
  }

  it('compacts a spread graph without requiring a filled rectangle', () => {
    const boxes = flow.nodes.map((n, i) => ({ ...n, x: i * 1000, y: i * 100 }));
    const before =
      Math.max(...boxes.map((b) => b.x)) - Math.min(...boxes.map((b) => b.x));
    spaceBoxLayout(boxes, flow, new Map(), false, true);
    assertSeparated(boxes, false);
    expect(
      Math.max(...boxes.map((b) => b.x)) - Math.min(...boxes.map((b) => b.x)),
    ).toBeLessThan(before);
  });

  it('handles a fixed anchor after free boxes in collision ordering', () => {
    const boxes: BoxNode[] = Array.from({ length: 25 }, (_, i) => ({
      ...flow.nodes[0],
      id: String(i),
      x: 0,
      y: 0,
    }));
    spaceBoxLayout(
      boxes,
      { ...flow, links: [] },
      new Map([['24', { x: -38, y: 0 }]]),
      false,
      true,
    );
    assertSeparated(boxes, false);
    expect(boxes[24].x).toEqual(-38);
    expect(boxes[24].y).toEqual(0);
  });

  it('separates a diagonal neighbor from a later fixed anchor', () => {
    const boxes: BoxNode[] = [
      { ...flow.nodes[0], id: 'free', x: 30, y: 30 },
      { ...flow.nodes[1], id: 'pin', x: 0, y: 0 },
    ];
    const data = {
      ...flow,
      links: [{ ...flow.links[0], source: 'free', target: 'pin' }],
    };
    spaceBoxLayout(
      boxes,
      data,
      new Map([['pin', { x: 0, y: 0 }]]),
      false,
      true,
    );
    assertSeparated(boxes, false);
  });

  it('allows empty cells between distant fixed anchors', () => {
    const boxes = flow.nodes.map((n, i) => ({ ...n, x: i * 380, y: 0 }));
    const pins = new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
    spaceBoxLayout(boxes, flow, pins, true, true);
    expect(boxes[1].x - boxes[0].x).toEqual(380);
    assertSeparated(boxes, true);
  });

  it('resolves coincident boxes, missing coordinates, self links and dangling links', () => {
    for (const compact of [false, true]) {
      const boxes: BoxNode[] = Array.from({ length: 16 }, (_, i) => ({
        ...flow.nodes[0],
        id: String(i),
      }));
      const data = {
        ...flow,
        nodes: boxes,
        links: [
          ...flow.links,
          { ...flow.links[0], source: '0', target: '0' },
          { ...flow.links[0], source: '0', target: 'missing' },
          { ...flow.links[0], source: '0', target: '1' },
        ],
      };
      spaceBoxLayout(
        boxes,
        data,
        new Map([
          ['0', { x: 0, y: 0 }],
          ['15', { x: 38, y: 0 }],
        ]),
        true,
        compact,
      );
      assertSeparated(boxes, true);
    }
    const boxes: BoxNode[] = flow.nodes.map((n) => ({ ...n }));
    spaceBoxLayout(boxes, { ...flow, links: [] }, new Map(), false, true);
    assertSeparated(boxes, false);
  });
});
