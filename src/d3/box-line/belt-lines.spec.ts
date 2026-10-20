import { beltLines } from './belt-lines';
import { BoxEdge, BoxNode } from './models';

describe('parallel belt lines', () => {
  const source = { id: 'source', x: 0, y: 0, width: 38, height: 38 } as BoxNode;
  const target = { ...source, id: 'target', x: 120, y: 80 };
  function edge(beltCount?: number): BoxEdge {
    return { sourceNode: source, targetNode: target, beltCount } as BoxEdge;
  }
  it('draws exactly one full path per required belt', () => {
    for (const count of [0, 1, 2, 3, 25]) {
      const result = beltLines(edge(count));
      expect(result.path.match(/M/g)?.length ?? 0).toEqual(count);
      expect(result.multiplier).toEqual(1);
      expect(result.width).toBeGreaterThan(0);
      expect(result.path).not.toContain('NaN');
    }
    expect(beltLines(edge()).path).toEqual('');
  });
  it('groups only extreme counts with an explicit multiplier and bounded geometry', () => {
    const result = beltLines(edge(8193));
    expect(result.multiplier).toEqual(3);
    expect(result.path.match(/M/g)?.length).toEqual(2731);
  });
  it('keeps parallel curves for bidirectional flows, loops and coincident nodes', () => {
    const bidi = beltLines({ ...edge(3), bidi: true });
    expect(bidi.path.match(/M/g)?.length).toEqual(3);
    expect(bidi.path).toContain('C');
    const loop = beltLines({ ...edge(3), targetNode: source });
    expect(loop.path.match(/M/g)?.length).toEqual(3);
    expect(loop.path).toContain('C');
    expect(loop.path).not.toContain('NaN');
    const missing = { id: 'empty' } as BoxNode;
    expect(
      beltLines({ ...edge(1), sourceNode: missing, targetNode: missing }).path,
    ).not.toContain('NaN');
  });
});
