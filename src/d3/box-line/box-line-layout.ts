import { ElkExtendedEdge, ElkNode } from 'elkjs';

import { FlowData } from '~/flow/flow-data';
import { Link } from '~/flow/link';
import { ElkAlgorithm } from '~/state/preferences/elk-algorithm';

import { BoxNode } from './models';

export interface BoxPosition {
  x: number;
  y: number;
}

export interface BoxGraph extends ElkNode {
  children: BoxNode[];
  edges: (Link & ElkExtendedEdge)[];
}

/** Give free nodes a different, reproducible starting point on each retry. */
function offset(id: string, seed: number): BoxPosition {
  let hash = seed;
  for (const char of id) hash = Math.imul(hash, 31) + char.charCodeAt(0);
  const angle = (hash >>> 0) * 2.399963229728653;
  return { x: Math.cos(angle) * 120, y: Math.sin(angle) * 120 };
}

export function createBoxGraph(
  flow: FlowData,
  algorithm: ElkAlgorithm,
  positions: ReadonlyMap<string, BoxPosition>,
  pins: ReadonlyMap<string, BoxPosition>,
  seed: number,
): BoxGraph {
  const anchors = [...pins.values()];
  const center = {
    x: anchors.reduce((sum, p) => sum + p.x, 0) / (anchors.length || 1),
    y: anchors.reduce((sum, p) => sum + p.y, 0) / (anchors.length || 1),
  };
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': pins.size ? 'stress' : algorithm,
      'elk.randomSeed': seed.toString(),
      ...(pins.size ? { 'elk.interactive': 'true' } : {}),
    },
    children: flow.nodes.map((n) => {
      const pinned = pins.get(n.id);
      const previous = positions.get(n.id) ?? center;
      const jitter = offset(n.id, seed);
      return {
        ...n,
        width: 38,
        height: 38,
        ...(pins.size
          ? {
              x: pinned?.x ?? previous.x + jitter.x,
              y: pinned?.y ?? previous.y + jitter.y,
            }
          : {}),
        ...(pinned ? { layoutOptions: { 'elk.stress.fixed': 'true' } } : {}),
      };
    }),
    edges: flow.links.map((l) => ({
      ...l,
      id: l.source + '|' + l.target,
      sources: [l.source],
      targets: [l.target],
    })),
  };
}

/**
 * ELK translates connected components after layout, including fixed nodes.
 * Undo that translation per component so pin coordinates remain exact.
 */
export function restoreBoxPins(
  boxes: BoxNode[],
  flow: FlowData,
  pins: ReadonlyMap<string, BoxPosition>,
): void {
  const records = new Map(
    boxes.map((b) => [b.id, { box: b, neighbors: new Set<string>() }]),
  );
  for (const link of flow.links) {
    records.get(link.source)?.neighbors.add(link.target);
    records.get(link.target)?.neighbors.add(link.source);
  }
  const visited = new Set<string>();
  for (const box of boxes) {
    if (visited.has(box.id)) continue;
    const component: BoxNode[] = [];
    const pending = [box.id];
    while (pending.length) {
      const id = pending.pop();
      if (id == null || visited.has(id)) continue;
      visited.add(id);
      const record = records.get(id);
      if (record == null) continue;
      component.push(record.box);
      pending.push(...record.neighbors);
    }
    for (const anchor of component) {
      const target = pins.get(anchor.id);
      if (target == null) continue;
      const dx = target.x - (anchor.x ?? 0);
      const dy = target.y - (anchor.y ?? 0);
      for (const node of component) {
        const pinned = pins.get(node.id);
        node.x = pinned?.x ?? (node.x ?? 0) + dx;
        node.y = pinned?.y ?? (node.y ?? 0) + dy;
      }
      break;
    }
  }
}

export function boxViewBox(boxes: BoxNode[]): string {
  if (!boxes.length) return '0 0 1 1';
  const x = Math.min(...boxes.map((b) => b.x ?? 0)) - 20;
  const y = Math.min(...boxes.map((b) => b.y ?? 0)) - 20;
  const right = Math.max(...boxes.map((b) => (b.x ?? 0) + (b.width ?? 38)));
  const bottom = Math.max(...boxes.map((b) => (b.y ?? 0) + (b.height ?? 38)));
  return `${x} ${y} ${right - x + 20} ${bottom - y + 20}`;
}
