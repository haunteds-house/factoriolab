import { ComponentFixture, TestBed } from '@angular/core/testing';
import { select } from 'd3';

import { FlowDiagram } from '~/state/preferences/flow-diagram';
import { initialFlowSettings } from '~/state/preferences/flow-settings';
import { SankeyAlign } from '~/state/preferences/sankey-align';
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
