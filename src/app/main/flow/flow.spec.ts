import { ComponentFixture, TestBed } from '@angular/core/testing';
import { select } from 'd3';

import { rational } from '~/rational/rational';
import { FlowDiagram } from '~/state/preferences/flow-diagram';
import { initialFlowSettings } from '~/state/preferences/flow-settings';
import { LinkValue } from '~/state/preferences/link-value';
import { SankeyAlign } from '~/state/preferences/sankey-align';
import { ItemId } from '~/tests/item-id';
import { Mocks } from '~/tests/mocks/mocks';
import { TestModule } from '~/tests/test-module';
import {
  altClickSelector,
  assert,
  dragAndDropSelector,
  zoomSelector,
} from '~/tests/utils';
import { spread } from '~/utils/object';

import { Flow, SVG_ID } from './flow';

describe('Flow', () => {
  let component: Flow;
  let fixture: ComponentFixture<Flow>;
  let mocks: Mocks;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestModule, Flow],
    }).compileComponents();

    mocks = TestBed.inject(Mocks);
    fixture = TestBed.createComponent(Flow);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // Settle the initial debounced store emission before testing chart methods directly.
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('rebuildChart', () => {
    it('should call to rebuild the sankey', async () => {
      spyOn(component, 'rebuildSankey');
      await component.rebuildChart(mocks.flow(), initialFlowSettings);
      expect(component.rebuildSankey).toHaveBeenCalledWith(
        mocks.flow(),
        initialFlowSettings,
      );
    });

    it('should call to rebuild the box-line', async () => {
      spyOn(component, 'rebuildBoxLine');
      const flow = mocks.flow();
      const flowSettings = spread(initialFlowSettings, {
        diagram: FlowDiagram.BoxLine,
      });
      await component.rebuildChart(flow, flowSettings);
      expect(component.rebuildBoxLine).toHaveBeenCalledWith(flow, flowSettings);
    });
  });

  it('exports the displayed series order while other views export the ordinary flow', () => {
    const flow = mocks.flow();
    const exportJson = spyOn(component['exporter'], 'flowToJson');
    const route = spyOn(component['flowBuilder'], 'seriesFlow').and.returnValue(
      flow,
    );
    const settings = spyOn(
      component['preferencesStore'],
      'flowSettings',
    ).and.returnValue(initialFlowSettings);
    component['exportFlow'](flow);
    expect(route).not.toHaveBeenCalled();
    settings.and.returnValue({
      ...initialFlowSettings,
      diagram: FlowDiagram.BoxLine,
      seriesRouting: false,
    });
    component['exportFlow'](flow);
    expect(route).not.toHaveBeenCalled();
    settings.and.returnValue({
      ...initialFlowSettings,
      diagram: FlowDiagram.BoxLine,
      seriesRouting: true,
    });
    component['exportFlow'](flow);
    expect(route).toHaveBeenCalledWith(flow, component['boxPositions']);
    expect(exportJson).toHaveBeenCalledWith(flow);
  });

  describe('rebuildSankey', () => {
    beforeEach(() => {
      select(`#${SVG_ID} > *`).remove();
      component.rebuildSankey(mocks.flow(), initialFlowSettings);
    });

    it('should build the sankey', () => {
      const gElements = document.getElementsByTagName('g');
      expect(gElements.length).toEqual(8);
    });

    it('should handle drag and drop', () => {
      dragAndDropSelector(fixture, '#lab-flow-svg svg svg', 100, 200);
      assert(component['svg'] != null);
      expect(component['svg'].select('svg').attr('transform')).toBeTruthy();
    });

    for (const align of [
      SankeyAlign.Justify,
      SankeyAlign.Left,
      SankeyAlign.Right,
      SankeyAlign.Center,
    ]) {
      it(`pins and regenerates Sankey with ${align} alignment`, () => {
        component.togglePinMode();
        altClickSelector(fixture, '[data-flow-node]');
        const id = mocks.flow().nodes[0].id;
        expect(component['pinnedNodes']().has(id)).toBeTrue();
        dragAndDropSelector(fixture, '[data-flow-node]', 50, 75);
        const anchor = component['pinnedNodes']().get(id)!;
        component['layoutSeed']++;
        select(`#${SVG_ID} > *`).remove();
        component.rebuildSankey(mocks.flow(), {
          ...initialFlowSettings,
          sankeyAlign: align,
        });
        expect(component['boxPositions'].get(id)).toEqual(anchor);
        expect(
          component['svg']?.select('[data-flow-node]').attr('aria-pressed'),
        ).toEqual('true');
        const graph = component['svg']!.selectAll<
          SVGSVGElement,
          { x0: number; x1: number; y0: number; y1: number }
        >('[data-flow-node]').data();
        expect(
          graph.every((n) => [n.x0, n.x1, n.y0, n.y1].every(Number.isFinite)),
        ).toBeTrue();
        component.clearPins();
        expect(component['pinnedNodes']().size).toEqual(0);
      });
    }

    it('supports keyboard pinning and regenerates without a saved viewport', () => {
      const node = fixture.nativeElement.querySelector(
        '[data-flow-node]',
      ) as SVGElement;
      node.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
      );
      expect(component['pinnedNodes']().has('r|0')).toBeTrue();
      component['svg']?.attr('viewBox', null);
      component.rebuildSankey(mocks.flow(), initialFlowSettings);
      expect(component['svg']?.attr('viewBox')).not.toContain('NaN');
      expect(component['boxPositions'].get('r|0')).toEqual(
        component['pinnedNodes']().get('r|0'),
      );
    });

    it('should handle zoom', () => {
      zoomSelector(fixture, '#lab-flow-svg > svg', 500);
      assert(component['svg'] != null);
      expect(component['svg'].select('svg > g').attr('transform')).toBeTruthy();
    });

    it('should set selectedId when a rect is clicked', () => {
      altClickSelector(fixture, '#lab-flow-svg svg svg');
      expect(component['selectedId']()).toEqual(mocks.flow().nodes[0].stepId);
    });

    it('should not set selectedId when default is prevented', () => {
      spyOn(component['selectedId'], 'set');
      altClickSelector(fixture, '#lab-flow-svg svg svg', 0, true);
      expect(component['selectedId'].set).not.toHaveBeenCalled();
    });
  });

  describe('rebuildBoxLine', () => {
    beforeEach(() => {
      select(`#${SVG_ID} > *`).remove();
    });

    it('should build the box-line', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      const gElements = document.getElementsByTagName('g');
      expect(gElements.length).toEqual(8);
    });

    it('should exit early if result is invalid', async () => {
      spyOn(component['elk'], 'layout').and.returnValue(
        Promise.resolve({ children: [], edges: [], width: 1 }),
      );
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      const gElements = document.getElementsByTagName('g');
      expect(gElements.length).toEqual(0);
    });

    it('should handle drag and drop', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      assert(component['svg'] != null);
      const movingEl = component['svg'].select('svg');
      const x = movingEl.attr('x');
      const y = movingEl.attr('y');
      dragAndDropSelector(fixture, '#lab-flow-svg svg svg', 100, 200);
      expect(movingEl.attr('x')).not.toEqual(x);
      expect(movingEl.attr('y')).not.toEqual(y);
    });

    it('should handle zoom', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      zoomSelector(fixture, '#lab-flow-svg > svg', 500);
      assert(component['svg'] != null);
      expect(component['svg'].select('svg > g').attr('transform')).toBeTruthy();
    });

    it('renders a box-sized grid, snaps dragging, and preserves pins on regeneration', async () => {
      const settings = {
        ...initialFlowSettings,
        gridSnap: true,
        compactLayout: true,
      };
      await component.rebuildBoxLine(mocks.flow(), settings);
      const pattern = component['svg']?.select('[data-box-grid-pattern]');
      expect(pattern?.attr('width')).toEqual('38');
      expect(pattern?.attr('height')).toEqual('38');
      expect(
        component['svg']?.select('[data-box-node] rect').attr('width'),
      ).toEqual('37');
      component.toggleNodePin('r|0');
      dragAndDropSelector(fixture, '[data-box-node]', 113, 87);
      const moved = component['pinnedNodes']().get('r|0');
      expect((moved?.x ?? 0) % 38).toEqual(0);
      expect((moved?.y ?? 0) % 38).toEqual(0);
      zoomSelector(fixture, '#lab-flow-svg > svg', 300);
      expect(pattern?.attr('patternTransform')).toEqual(
        component['svg']?.select('g').attr('transform'),
      );
      await component.rebuildBoxLine(mocks.flow(), settings);
      expect(component['pinnedNodes']().get('r|0')).toEqual(moved);
    });

    it('constrains compact dragging even without grid and tolerates missing layout positions', async () => {
      spyOn(component['elk'], 'layout').and.resolveTo({
        children: mocks.flow().nodes,
        edges: [],
        width: 100,
        height: 100,
      });
      await component.rebuildBoxLine(mocks.flow(), {
        ...initialFlowSettings,
        compactLayout: true,
      });
      dragAndDropSelector(fixture, '[data-box-node]', 15, 15);
      expect(component['svg']?.selectAll('[data-box-node]').size()).toEqual(
        mocks.flow().nodes.length,
      );
    });

    it('draws whole belt lines only for solid links and updates their geometry when dragged', async () => {
      const data = mocks.flow();
      data.links = data.links.map((l, i) => ({
        ...l,
        beltCount: i === 0 ? 3 : i === 1 ? 8193 : undefined,
        itemId: 'iron',
        description: 'Iron carried: 100; used here: 60; continues: 40',
      }));
      await component.rebuildBoxLine(data, {
        ...initialFlowSettings,
        linkText: LinkValue.Belts,
      });
      const lanes = component['svg']?.select(
        '[data-belt-count="3"] [data-belt-lines]',
      );
      expect(lanes?.attr('d').match(/M/g)?.length).toEqual(3);
      expect(
        component['svg']
          ?.select('[data-belt-count="8193"]')
          .attr('data-belts-per-line'),
      ).toEqual('3');
      expect(
        component['svg']
          ?.selectAll<SVGTextPathElement, unknown>('textPath')
          .nodes()
          .some((n) => n.textContent === '×3'),
      ).toBeTrue();
      expect(component['svg']?.select('g title').text()).toContain(
        'Iron carried: 100',
      );
      const before = lanes?.attr('d');
      dragAndDropSelector(fixture, '[data-box-node]', 100, 80);
      expect(lanes?.attr('d')).not.toEqual(before);
      await component.rebuildBoxLine(data, initialFlowSettings);
      expect(component['svg']?.selectAll('[data-belt-lines]').size()).toEqual(
        0,
      );
    });

    it('reroutes by actual coordinates after layout and dragging, with recalculated belts and labels', async () => {
      const data = mocks.flow();
      const source = data.nodes[0].id,
        first = data.nodes[1].id,
        second = data.nodes[2].id;
      const settings = {
        ...initialFlowSettings,
        diagram: FlowDiagram.BoxLine,
        seriesRouting: true,
        linkText: LinkValue.Belts,
      };
      spyOn(
        component['flowBuilder']['objectivesStore'],
        'steps',
      ).and.returnValue([
        {
          id: 'iron',
          itemId: ItemId.IronPlate,
          items: rational(100n),
          belts: rational('2.4'),
        },
      ]);
      const preferences = mocks.preferencesStore.state();
      spyOn(
        component['flowBuilder']['preferencesStore'],
        'state',
      ).and.returnValue({
        ...preferences,
        flowSettings: settings,
      });
      data.links = [
        {
          ...data.links[0],
          source,
          target: first,
          itemId: ItemId.IronPlate,
          share: rational('0.6'),
          beltCount: 2,
        },
        {
          ...data.links[0],
          source,
          target: second,
          itemId: ItemId.IronPlate,
          share: rational('0.4'),
          beltCount: 1,
        },
      ];
      spyOn(component['elk'], 'layout').and.resolveTo({
        children: data.nodes.map((n, i) => ({
          ...n,
          x: [0, 80, 200][i],
          y: 0,
          width: 38,
          height: 38,
        })),
        edges: [],
        width: 300,
        height: 100,
      });
      await component.rebuildBoxLine(data, settings);
      const links = component['svg']
        ?.selectAll<SVGGElement, unknown>('[data-flow-link]')
        .nodes();
      assert(links != null);
      expect(links[0].getAttribute('data-source')).toEqual(source);
      expect(links[0].getAttribute('data-belt-count')).toEqual('3');
      const geometry = links[0]
        .querySelector('[data-belt-lines]')
        ?.getAttribute('d');
      dragAndDropSelector(fixture, `[data-box-node="${first}"]`, 400, 0);
      expect(links[0].getAttribute('data-source')).toEqual(second);
      expect(links[1].getAttribute('data-source')).toEqual(source);
      expect(links[0].getAttribute('data-belt-count')).toEqual('2');
      expect(
        links[0].querySelector('[data-belt-lines]')?.getAttribute('d'),
      ).not.toEqual(geometry);
      expect(data.links.every((l) => l.source === source)).toBeTrue();
    });

    it('builds PCB traces on a mandatory routing grid and reroutes after moving a pinned footprint', async () => {
      const data = mocks.flow();
      data.links = data.links.map((l) => ({ ...l, beltCount: 3 }));
      const settings = {
        ...initialFlowSettings,
        diagram: FlowDiagram.Pcb,
        linkText: LinkValue.Belts,
      };
      await component.rebuildBoxLine(data, settings);
      expect(component['pcbMetrics']()?.unrouted).toEqual(0);
      expect(component['svg']?.selectAll('[data-pcb-trace]').size()).toEqual(
        data.links.length,
      );
      expect(
        component['svg']?.select('[data-box-grid-pattern]').attr('width'),
      ).toEqual('38');
      component.toggleNodePin(data.nodes[0].id);
      const before = component['svg']?.select('[data-pcb-trace]').attr('d');
      dragAndDropSelector(fixture, '[data-box-node]', 160, 90);
      expect(
        component['svg']?.select('[data-pcb-trace]').attr('d'),
      ).not.toEqual(before);
      expect(component['pcbMetrics']()?.unrouted).toEqual(0);
      const pin = component['pinnedNodes']().get(data.nodes[0].id);
      await component.rebuildBoxLine(data, settings);
      expect(component['pinnedNodes']().get(data.nodes[0].id)).toEqual(pin);
      await component.rebuildBoxLine(data, initialFlowSettings);
      expect(component['pcbMetrics']()).toBeNull();
      await component.rebuildBoxLine(data, {
        ...settings,
        linkText: LinkValue.Items,
      });
      expect(component['pcbMetrics']()?.unrouted).toEqual(0);
    });

    it('reports a PCB net that cannot be routed instead of drawing through footprints', async () => {
      const data = mocks.flow();
      data.links = [{ ...data.links[0], target: 'missing' }];
      spyOn(component['elk'], 'layout').and.resolveTo({
        children: data.nodes,
        edges: [],
        width: 100,
        height: 100,
      });
      const settings = { ...initialFlowSettings, diagram: FlowDiagram.Pcb };
      spyOn(component['preferencesStore'], 'flowSettings').and.returnValue(
        settings,
      );
      await component.rebuildBoxLine(data, settings);
      fixture.detectChanges();
      expect(component['pcbMetrics']()?.unrouted).toEqual(1);
      expect(
        fixture.nativeElement.querySelector('[role="alert"]'),
      ).not.toBeNull();
    });

    it('should set selectedId when a rect is clicked', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      altClickSelector(fixture, '#lab-flow-svg svg svg');
      expect(component['selectedId']()).toEqual(mocks.flow().nodes[0].stepId);
    });

    it('should not set selectedId when default is prevented', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      spyOn(component['selectedId'], 'set');
      altClickSelector(fixture, '#lab-flow-svg svg svg', 0, true);
      expect(component['selectedId'].set).not.toHaveBeenCalled();
    });

    it('pins boxes on click in pin mode and leaves details selection alone', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      component.togglePinMode();
      altClickSelector(fixture, '[data-box-node]');
      expect(component['pinnedNodes']().has('r|0')).toBeTrue();
      expect(component['selectedId']()).toBeUndefined();
      expect(
        fixture.nativeElement
          .querySelector('[data-box-node]')
          .getAttribute('aria-pressed'),
      ).toEqual('true');
      altClickSelector(fixture, '[data-box-node]');
      expect(component['pinnedNodes']().size).toEqual(0);
    });

    it('supports shift-click and keyboard pinning', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      const node = fixture.nativeElement.querySelector(
        '[data-box-node]',
      ) as SVGElement;
      node.dispatchEvent(new MouseEvent('click', { shiftKey: true }));
      expect(component['pinnedNodes']().has('r|0')).toBeTrue();
      node.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
      );
      expect(component['pinnedNodes']().size).toEqual(0);
      node.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(component['selectedId']()).toEqual('r|0');
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(component['pinnedNodes']().size).toEqual(0);
      component.togglePinMode();
      node.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(component['pinnedNodes']().has('r|0')).toBeTrue();
    });

    it('keeps moved pins and the viewport fixed when regenerating', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      component.toggleNodePin('r|0');
      component.toggleNodePin('r|1');
      const original = component['pinnedNodes']().get('r|0');
      dragAndDropSelector(fixture, '[data-box-node]', 100, 80);
      const moved = component['pinnedNodes']().get('r|0');
      expect(moved).not.toEqual(original);
      const pins = new Map(component['pinnedNodes']());
      zoomSelector(fixture, '#lab-flow-svg > svg', 300);
      const viewBox = component['svg']?.attr('viewBox');
      const transform = component['svg']?.select('g').attr('transform');
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      expect(component['svg']?.attr('viewBox')).toEqual(viewBox);
      expect(component['svg']?.select('g').attr('transform')).toEqual(
        transform,
      );
      for (const [id, p] of pins) {
        expect(component['boxPositions'].get(id)).toEqual(p);
      }
      component.clearPins();
      expect(component['pinnedNodes']().size).toEqual(0);
    });

    it('drops pins for nodes removed from the graph', async () => {
      const flow = mocks.flow();
      await component.rebuildBoxLine(flow, initialFlowSettings);
      component.toggleNodePin('r|0');
      await component.rebuildBoxLine(
        {
          nodes: flow.nodes.filter((n) => n.id !== 'r|0'),
          links: flow.links.filter((l) => l.source !== 'r|0'),
        },
        initialFlowSettings,
      );
      expect(component['pinnedNodes']().size).toEqual(0);
    });

    it('keeps the current chart and pins when the layout fails', async () => {
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      component.toggleNodePin('r|0');
      const svg = component['svg']?.node();
      spyOn(component['elk'], 'layout').and.returnValue(
        Promise.reject(new Error('failed')),
      );
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      expect(component['svg']?.node()).toBe(svg);
      expect(component['pinnedNodes']().has('r|0')).toBeTrue();
      expect(component['layoutError']()).toBeTrue();
      expect(component['layoutPending']()).toBeFalse();
    });

    it('ignores a completed layout after switching away from box-line', async () => {
      let finish: (value: any) => void = () => {};
      spyOn(component['elk'], 'layout').and.returnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const pending = component.rebuildBoxLine(
        mocks.flow(),
        initialFlowSettings,
      );
      await component.rebuildChart(mocks.flow(), initialFlowSettings);
      const sankeySvg = component['svg']?.node();
      finish({
        children: mocks.flow().nodes,
        edges: [],
        width: 100,
        height: 100,
      });
      await pending;
      expect(component['svg']?.node()).toBe(sankeySvg);
      expect(component['layoutPending']()).toBeFalse();
    });

    it('requests a new layout seed when regenerating', async () => {
      const rebuild = spyOn(component, 'rebuildChart').and.resolveTo();
      const seed = component['layoutSeed'];
      await component.regenerateLayout();
      expect(component['layoutSeed']).toEqual(seed + 1);
      expect(rebuild).toHaveBeenCalledWith(
        component['flowBuilder'].flowData(),
        component['preferencesStore'].flowSettings(),
      );
    });

    it('handles missing layout coordinates and unknown pin IDs safely', async () => {
      spyOn(component['elk'], 'layout').and.resolveTo({
        children: mocks.flow().nodes,
        edges: [],
        width: 100,
        height: 100,
      });
      await component.rebuildBoxLine(mocks.flow(), initialFlowSettings);
      expect(component['boxPositions'].get('r|0')).toEqual({ x: 0, y: 0 });
      component.toggleNodePin('unknown');
      expect(component['pinnedNodes']().size).toEqual(0);
    });
  });
});
