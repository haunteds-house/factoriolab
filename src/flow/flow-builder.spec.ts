import { TestBed } from '@angular/core/testing';
import ELK from 'elkjs';

import { createBoxGraph } from '~/d3/box-line/box-line-layout';
import { rational } from '~/rational/rational';
import { Step } from '~/solver/step';
import { initialColumnsState } from '~/state/preferences/columns-state';
import { FlowDiagram } from '~/state/preferences/flow-diagram';
import { initialFlowSettings } from '~/state/preferences/flow-settings';
import { LinkValue } from '~/state/preferences/link-value';
import { initialPreferencesState } from '~/state/preferences/preferences-state';
import { ItemId } from '~/tests/item-id';
import { Mocks } from '~/tests/mocks/mocks';
import { mockUncommonQualityJson } from '~/tests/mocks/quality';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';
import { spread } from '~/utils/object';

import { FlowBuilder, MIN_LINK_VALUE } from './flow-builder';
import { Link } from './link';

describe('FlowService', () => {
  let service: FlowBuilder;
  let mocks: Mocks;
  const fullStep: Step = {
    id: '0',
    items: rational(2n),
    belts: rational(3n),
    wagons: rational(4n),
    machines: rational(5n),
  };
  const emptyStep: Step = { id: '0' };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestModule] });
    service = TestBed.inject(FlowBuilder);
    mocks = TestBed.inject(Mocks);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('flowData', () => {
    it('should return null if no steps', () => {
      expect(service.flowData()).toBeNull();
    });

    it('should call to build the graph', () => {
      spyOn<any>(service, 'buildGraph');
      spyOn(service['objectivesStore'], 'steps').and.returnValue(mocks.steps());
      expect(service.flowData()).toBeUndefined();
      expect(service['buildGraph']).toHaveBeenCalled();
    });
  });

  describe('recipeStepNodeType', () => {
    it('should return different prefix for recipe objective steps', () => {
      expect(service['recipeStepNodeType']({} as any)).toEqual('r');
      expect(
        service['recipeStepNodeType']({ recipeObjectiveId: 'obj' } as any),
      ).toEqual('m');
    });
  });

  describe('buildGraph', () => {
    it('should handle various link and node types', () => {
      const result = service['buildGraph'](
        mocks.lightOilSteps(),
        '/m',
        mocks.settingsStore.settings(),
        mocks.preferencesStore.state(),
        mocks.recipesStore.adjustedDataset(),
      );

      expect(result.nodes.length).toEqual(7);
      expect(result.links.length).toEqual(8);
    });

    it('should handle different link text selection', () => {
      const result = service['buildGraph'](
        mocks.lightOilSteps(),
        '/m',
        mocks.settingsStore.settings(),
        spread(initialPreferencesState, {
          flowSettings: spread(initialFlowSettings, {
            linkText: LinkValue.None,
          }),
        }),
        mocks.recipesStore.adjustedDataset(),
      );

      expect(result.nodes.length).toEqual(7);
      expect(result.links.length).toEqual(8);
    });

    it('should handle missing recipeId on parent', () => {
      const steps = [...mocks.lightOilSteps()];
      const broken = spread(steps[1], { parents: { '4': rational.one } });
      steps[1] = broken;
      const result = service['buildGraph'](
        steps,
        '/m',
        mocks.settingsStore.settings(),
        mocks.preferencesStore.state(),
        mocks.recipesStore.adjustedDataset(),
      );

      expect(result.nodes.length).toEqual(7);
      expect(result.links.length).toEqual(7);
    });

    it('should hide excluded items if specified', () => {
      const result = service['buildGraph'](
        mocks.lightOilSteps(),
        '/m',
        {
          ...mocks.settingsStore.settings(),
          excludedItemIds: new Set([ItemId.Water]),
        },
        {
          ...mocks.preferencesStore.state(),
          flowSettings: { ...initialFlowSettings, hideExcluded: true },
        },
        mocks.recipesStore.adjustedDataset(),
      );

      expect(result.nodes.length).toEqual(6);
      expect(result.links.length).toEqual(5);
    });

    it('should include quality icons', () => {
      const data = mocks.getAdjustedDataset();
      data.iconRecord.item[ItemId.Water].quality = mockUncommonQualityJson;
      data.iconRecord.item[ItemId.OffshorePump].quality =
        mockUncommonQualityJson;
      data.iconRecord.recipe[RecipeId.Water].quality = mockUncommonQualityJson;

      data.iconRecord.quality[mockUncommonQualityJson.id] = 'test' as any;
      const result = service['buildGraph'](
        mocks.lightOilSteps(),
        '/m',
        mocks.settingsStore.settings(),
        mocks.preferencesStore.state(),
        data,
      );

      expect(result.nodes[6].qualityIcon).toEqual('test' as any);
      expect(result.nodes[6].recipeQualityIcon).toEqual('test' as any);
    });

    it('should handle a missing machine', () => {
      const steps = mocks
        .lightOilSteps()
        .map((s) => (s.id === '1' ? { ...s, recipeSettings: undefined } : s));

      const result = service['buildGraph'](
        steps,
        '/m',
        mocks.settingsStore.settings(),
        mocks.preferencesStore.state(),
        mocks.recipesStore.adjustedDataset(),
      );

      expect(result.nodes.length).toEqual(7);
      expect(result.links.length).toEqual(8);
    });
  });

  describe('whole belt counts and series routing', () => {
    it('rounds each allocated flow up exactly, without changing the input rate', () => {
      const step = { id: 'item', belts: rational('2.4') };
      expect(service['linkBelts'](step, rational.one, rational.one)).toEqual(3);
      expect(service['linkBelts'](step, rational('0.5'), rational.one)).toEqual(
        2,
      );
      expect(
        service['linkBelts'](
          { id: 'item', belts: rational(3n) },
          rational.one,
          rational.one,
        ),
      ).toEqual(3);
      expect(
        service['linkBelts']({ id: 'item' }, rational.one, rational.one),
      ).toBeUndefined();
      expect(
        service['linkBelts'](step, rational.one, undefined),
      ).toBeUndefined();
      expect(
        service['linkBelts'](
          { ...step, belts: rational.zero },
          rational.one,
          rational.one,
        ),
      ).toEqual(0);
      expect(step.belts.toString()).toEqual('2.4');
    });

    function distribution(): Link[] {
      return [
        {
          source: 'furnaces',
          target: 'circuits',
          itemId: 'iron',
          share: rational('0.3'),
          beltCount: 3,
          text: '3',
          value: 30,
          color: 'gray',
        },
        {
          source: 'furnaces',
          target: 'steel',
          itemId: 'iron',
          share: rational('0.6'),
          beltCount: 6,
          text: '6',
          value: 60,
          color: 'gray',
        },
        {
          source: 'furnaces',
          target: 'o|iron',
          itemId: 'iron',
          share: rational('0.1'),
          beltCount: 1,
          text: '1',
          value: 10,
          color: 'gray',
        },
      ];
    }
    it('falls back to output share without positions and preserves exact remainders', () => {
      const links = distribution();
      const carried: string[] = [],
        taken: string[] = [];
      service['routeSeries'](
        { nodes: [], links },
        (link, remaining, use, total) => {
          carried.push(remaining.toString());
          taken.push(use.toString());
          expect(total.eq(rational.one)).toBeTrue();
          return { ...link, value: remaining.toNumber() };
        },
      );
      expect(carried).toEqual(['1', '0.4', '0.1']);
      expect(taken).toEqual(['0.6', '0.3', '0.1']);
      expect(links.find((l) => l.target === 'steel')?.source).toEqual(
        'furnaces',
      );
      expect(links.find((l) => l.target === 'circuits')?.source).toEqual(
        'steel',
      );
      expect(links.find((l) => l.target === 'o|iron')?.source).toEqual(
        'circuits',
      );
      expect(links.map((l) => l.share?.toString())).toEqual([
        '0.3',
        '0.6',
        '0.1',
      ]);
    });
    it('visits the nearest consumer ahead of a larger, distant consumer, keeping sinks last', () => {
      const links = distribution();
      const carried: string[] = [];
      service['routeSeries'](
        { nodes: [], links },
        (l, remaining) => {
          carried.push(remaining.toString());
          return { ...l };
        },
        new Map([
          ['furnaces', { x: 0, y: 0 }],
          ['circuits', { x: 10, y: 0 }],
          ['steel', { x: 100, y: 0 }],
          ['o|iron', { x: 1, y: 0 }],
        ]),
      );
      expect(links.find((l) => l.target === 'circuits')?.source).toEqual(
        'furnaces',
      );
      expect(links.find((l) => l.target === 'steel')?.source).toEqual(
        'circuits',
      );
      expect(links.find((l) => l.target === 'o|iron')?.source).toEqual('steel');
      expect(carried).toEqual(['1', '0.7', '0.1']);
    });

    it('measures each next hop from the last consumer and uses share to break equal-distance ties', () => {
      const base = distribution()[0];
      const links = [
        { ...base, target: 'a', share: rational('0.4') },
        { ...base, target: 'b', share: rational('0.3') },
        { ...base, target: 'c', share: rational('0.3') },
      ];
      service['routeSeries'](
        { nodes: [], links },
        (l) => ({ ...l }),
        new Map([
          ['furnaces', { x: 0, y: 0 }],
          ['a', { x: 10, y: 0 }],
          ['b', { x: 0, y: 10 }],
          ['c', { x: 20, y: 0 }],
        ]),
      );
      expect(links.find((l) => l.target === 'a')?.source).toEqual('furnaces');
      expect(links.find((l) => l.target === 'c')?.source).toEqual('a');
      expect(links.find((l) => l.target === 'b')?.source).toEqual('c');
    });

    it('keeps separate materials, deterministic ties, and surplus last', () => {
      const base = distribution()[0];
      const links = [
        { ...base, target: 'b', share: rational('0.2') },
        { ...base, target: 'a', share: rational('0.2') },
        { ...base, target: 's|iron', share: rational('0.6') },
        { ...base, itemId: 'copper', target: 'x' },
        { ...base, itemId: 'copper', target: 'y' },
      ];
      service['routeSeries']({ nodes: [], links }, (l) => ({ ...l }));
      expect(links.find((l) => l.target === 'a')?.source).toEqual('furnaces');
      expect(links.find((l) => l.target === 'b')?.source).toEqual('a');
      expect(links.find((l) => l.target === 's|iron')?.source).toEqual('b');
      expect(links.find((l) => l.target === 'y')?.source).toEqual('x');
    });
    it('leaves fluids, missing data, zero flows, singleton groups and producer recycling direct', () => {
      const base = distribution()[0];
      const links: Link[] = [
        { ...base, itemId: 'fluid', beltCount: undefined },
        { ...base, itemId: undefined },
        { ...base, itemId: 'unknown', share: undefined },
        { ...base, itemId: 'zero', share: rational.zero },
        { ...base, itemId: 'single' },
        { ...base, itemId: 'recycle', target: 'furnaces' },
        { ...base, itemId: 'recycle', target: 'other' },
      ];
      const format = jasmine.createSpy('format');
      service['routeSeries']({ nodes: [], links }, format);
      expect(format).not.toHaveBeenCalled();
      expect(links.every((l) => l.source === 'furnaces')).toBeTrue();
    });
    it('applies series routing to solid items in Box-line, with formatted remaining flow and exact belts', async () => {
      const splitSteps: Step[] = [
        {
          id: 'iron',
          itemId: ItemId.IronPlate,
          recipeId: RecipeId.IronPlate,
          items: rational(100n),
          belts: rational('2.4'),
          parents: { steel: rational('0.6'), circuits: rational('0.2') },
          output: rational(10n),
          surplus: rational(10n),
          outputs: { [ItemId.IronPlate]: rational.one },
        },
        { id: 'steel', recipeId: RecipeId.SteelPlate },
        { id: 'circuits', recipeId: RecipeId.ElectronicCircuit },
      ];
      const original = splitSteps.map((s) => ({ ...s }));
      const preferences = {
        ...initialPreferencesState,
        flowSettings: {
          ...initialFlowSettings,
          diagram: FlowDiagram.BoxLine,
          seriesRouting: true,
          linkText: LinkValue.Belts,
        },
      };
      const base = service['buildGraph'](
        splitSteps,
        '/m',
        mocks.settingsStore.settings(),
        preferences,
        mocks.recipesStore.adjustedDataset(),
      );
      expect(base.links.every((l) => l.description == null)).toBeTrue();
      spyOn(service['objectivesStore'], 'steps').and.returnValue(splitSteps);
      spyOn(service['preferencesStore'], 'state').and.returnValue(preferences);
      const result = service.seriesFlow(
        base,
        new Map([
          ['r|iron-plate', { x: 0, y: 0 }],
          ['r|steel-plate', { x: 40, y: 0 }],
          ['r|electronic-circuit', { x: 100, y: 0 }],
        ]),
      );
      expect(
        base.links.find((l) => l.target === 'r|electronic-circuit')?.source,
      ).toEqual('r|iron-plate');
      expect(result.links.some((l) => l.description != null)).toBeTrue();
      expect(result.links.some((l) => l.beltCount === 3)).toBeTrue();
      expect(result.links.every((l) => Number.isFinite(l.value))).toBeTrue();
      const steel = result.links.find((l) => l.target === 'r|steel-plate');
      const circuits = result.links.find(
        (l) => l.target === 'r|electronic-circuit',
      );
      expect(steel?.beltCount).toEqual(3);
      expect(steel?.text).toEqual('2.4');
      expect(circuits?.source).toEqual('r|steel-plate');
      expect(circuits?.beltCount).toEqual(1);
      expect(splitSteps).toEqual(original);
      for (const algorithm of ['layered', 'force', 'stress'] as const) {
        const laidOut = await new ELK().layout(
          createBoxGraph(result, algorithm, new Map(), new Map(), 1),
        );
        expect(laidOut.children?.length).toEqual(result.nodes.length);
      }
    });
  });

  describe('stepLinkValue', () => {
    it('should handle all possible options', () => {
      expect(service['stepLinkValue'](fullStep, LinkValue.None)).toEqual(
        rational.one,
      );
      expect(service['stepLinkValue'](fullStep, LinkValue.Percent)).toEqual(
        rational.one,
      );
      expect(service['stepLinkValue'](fullStep, LinkValue.Items)).toEqual(
        rational(2n),
      );
      expect(service['stepLinkValue'](fullStep, LinkValue.Belts)).toEqual(
        rational(3n),
      );
      expect(service['stepLinkValue'](fullStep, LinkValue.Wagons)).toEqual(
        rational(4n),
      );
      expect(service['stepLinkValue'](fullStep, LinkValue.Machines)).toEqual(
        rational(5n),
      );
    });

    it('should handle undefined values', () => {
      expect(service['stepLinkValue'](emptyStep, LinkValue.Items)).toEqual(
        rational.zero,
      );
      expect(service['stepLinkValue'](emptyStep, LinkValue.Belts)).toEqual(
        rational.zero,
      );
      expect(service['stepLinkValue'](emptyStep, LinkValue.Wagons)).toEqual(
        rational.zero,
      );
      expect(service['stepLinkValue'](emptyStep, LinkValue.Machines)).toEqual(
        rational.zero,
      );
    });
  });

  describe('linkSize', () => {
    it('should handle all possible options', () => {
      expect(
        service['linkSize'](
          rational.one,
          rational.one,
          LinkValue.None,
          rational.one,
        ),
      ).toEqual(1);
      expect(
        service['linkSize'](
          rational.one,
          rational.one,
          LinkValue.Percent,
          rational.one,
        ),
      ).toEqual(1);
      expect(
        service['linkSize'](
          rational.one,
          rational.one,
          LinkValue.Items,
          rational.one,
        ),
      ).toEqual(1);
    });

    it('should fall back to minimum values', () => {
      expect(
        service['linkSize'](
          rational.one,
          rational.zero,
          LinkValue.Percent,
          rational.one,
        ),
      ).toEqual(MIN_LINK_VALUE);
      expect(
        service['linkSize'](
          rational.one,
          rational.zero,
          LinkValue.Items,
          rational.one,
        ),
      ).toEqual(MIN_LINK_VALUE);
    });
  });

  describe('linkText', () => {
    it('should handle all possible options', () => {
      expect(
        service['linkText'](
          rational.one,
          rational.one,
          LinkValue.None,
          initialColumnsState,
          '/m',
        ),
      ).toEqual('');
      expect(
        service['linkText'](
          rational.one,
          rational.one,
          LinkValue.Percent,
          initialColumnsState,
          '/m',
        ),
      ).toEqual('100%');
      expect(
        service['linkText'](
          rational.one,
          rational.one,
          LinkValue.Items,
          initialColumnsState,
          '/m',
        ),
      ).toEqual('1/m');
    });

    it('should handle null precision / remove suffix', () => {
      spyOn<any>(service, 'linkPrecision').and.returnValue(null);
      expect(
        service['linkText'](
          rational.one,
          rational.one,
          LinkValue.Machines,
          initialColumnsState,
          '/m',
        ),
      ).toEqual('1');
    });
  });

  describe('linkPrecision', () => {
    it('should handle all possible options', () => {
      expect(
        service['linkPrecision'](LinkValue.None, initialColumnsState),
      ).toEqual(null);
      expect(
        service['linkPrecision'](LinkValue.Percent, initialColumnsState),
      ).toEqual(null);
      expect(
        service['linkPrecision'](LinkValue.Items, initialColumnsState),
      ).toEqual(1);
      expect(
        service['linkPrecision'](LinkValue.Belts, initialColumnsState),
      ).toEqual(1);
      expect(
        service['linkPrecision'](LinkValue.Wagons, initialColumnsState),
      ).toEqual(1);
      expect(
        service['linkPrecision'](LinkValue.Machines, initialColumnsState),
      ).toEqual(1);
    });
  });
});
