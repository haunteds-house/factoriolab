import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  faArrowsRotate,
  faFileArrowDown,
  faGear,
  faThumbtack,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { drag, select, Selection, zoom, zoomTransform } from 'd3';
import ELK, { ElkNode } from 'elkjs';
import { combineLatest, debounceTime, switchMap } from 'rxjs';

import { Button } from '~/components/button/button';
import { FlowSettingsDialog } from '~/components/flow-settings-dialog/flow-settings-dialog';
import { Steps } from '~/components/steps/steps';
import { beltLines } from '~/d3/box-line/belt-lines';
import { boxEdgeLine } from '~/d3/box-line/box-line-edge';
import {
  BoxPosition,
  boxViewBox,
  createBoxGraph,
  restoreBoxPins,
} from '~/d3/box-line/box-line-layout';
import {
  BOX_SIZE,
  boxDropPosition,
  spaceBoxLayout,
} from '~/d3/box-line/box-line-spacing';
import { BoxEdge, BoxNode } from '~/d3/box-line/models';
import { num } from '~/d3/helpers';
import {
  sankeyCenter,
  sankeyJustify,
  sankeyLeft,
  sankeyRight,
} from '~/d3/sankey/align';
import {
  SankeyGraph,
  SankeyGraphMinimal,
  SankeyLayout,
  SankeyLinkExtraProperties,
  SankeyNode,
} from '~/d3/sankey/models';
import { sankey } from '~/d3/sankey/sankey';
import {
  sankeyLinkHorizontal,
  sankeyLinkLoop,
} from '~/d3/sankey/sankey-link-horizontal';
import { IconData } from '~/data/schema/icon-data';
import { Exporter } from '~/exporter/exporter';
import { FlowBuilder } from '~/flow/flow-builder';
import { FlowData } from '~/flow/flow-data';
import { Link } from '~/flow/link';
import { Node } from '~/flow/node';
import { FlowDiagram } from '~/state/preferences/flow-diagram';
import { FlowSettings } from '~/state/preferences/flow-settings';
import { LinkValue } from '~/state/preferences/link-value';
import { PreferencesStore } from '~/state/preferences/preferences-store';
import { SankeyAlign } from '~/state/preferences/sankey-align';
import { Translate } from '~/translate/translate';
import { TranslatePipe } from '~/translate/translate-pipe';
import { coalesce } from '~/utils/nullish';
import { spread } from '~/utils/object';

export const SVG_ID = 'lab-flow-svg';
const NODE_WIDTH = 36;

@Component({
  selector: 'lab-flow',
  imports: [Button, Steps, TranslatePipe],
  templateUrl: './flow.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-1 pb-3 sm:gap-2 lg:pb-6' },
})
export class Flow {
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(Translate);
  protected readonly dialog = inject(Dialog);
  protected readonly exporter = inject(Exporter);
  protected readonly flowBuilder = inject(FlowBuilder);
  protected readonly preferencesStore = inject(PreferencesStore);

  private readonly svgElement =
    viewChild.required<ElementRef<HTMLElement>>('svg');
  private readonly height = window.innerHeight * 0.75;
  /** Cached mainly for testing */
  private svg: Selection<SVGSVGElement, unknown, null, undefined> | undefined;

  protected readonly selectedId = signal<string | undefined>(undefined);

  protected readonly pinMode = signal(false);
  protected readonly pinnedNodes = signal<ReadonlyMap<string, BoxPosition>>(
    new Map(),
  );
  protected readonly layoutPending = signal(false);
  protected readonly layoutError = signal(false);
  protected readonly faArrowsRotate = faArrowsRotate;
  protected readonly faThumbtack = faThumbtack;
  protected readonly faXmark = faXmark;
  private readonly boxPositions = new Map<string, BoxPosition>();
  private layoutVersion = 0;
  private layoutSeed = 1;
  private currentBoxViewBox: string | undefined;
  private readonly elk = new ELK();
  protected readonly faFileArrowDown = faFileArrowDown;
  protected readonly faGear = faGear;
  protected readonly FlowSettingsDialog = FlowSettingsDialog;
  protected readonly FlowDiagram = FlowDiagram;
  protected readonly LinkValue = LinkValue;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.layoutVersion++;
    });
    combineLatest({
      data: toObservable(this.flowBuilder.flowData),
      settings: toObservable(this.preferencesStore.flowSettings),
    })
      .pipe(
        debounceTime(200),
        takeUntilDestroyed(this.destroyRef),
        switchMap(({ data, settings }) => this.rebuildChart(data, settings)),
      )
      .subscribe();
  }

  protected exportFlow(flow: FlowData): void {
    const settings = this.preferencesStore.flowSettings();
    this.exporter.flowToJson(
      settings.diagram === FlowDiagram.BoxLine && settings.seriesRouting
        ? this.flowBuilder.seriesFlow(flow, this.boxPositions)
        : flow,
    );
  }

  async rebuildChart(
    flowData: FlowData | null,
    flowSettings: FlowSettings,
  ): Promise<void> {
    if (flowData == null) {
      this.layoutVersion++;
      this.layoutPending.set(false);
      select(`#${SVG_ID} > *`).remove();
      return;
    }

    if (flowSettings.diagram === FlowDiagram.Sankey) {
      this.layoutVersion++;
      this.layoutPending.set(false);
      this.layoutError.set(false);
      this.rebuildSankey(flowData, flowSettings);
    } else await this.rebuildBoxLine(flowData, flowSettings);
  }

  async regenerateLayout(): Promise<void> {
    this.layoutSeed++;
    await this.rebuildChart(
      this.flowBuilder.flowData(),
      this.preferencesStore.flowSettings(),
    );
  }

  togglePinMode(): void {
    this.pinMode.update((value) => !value);
    this.updatePinStyles();
  }

  clearPins(): void {
    this.cancelPendingLayout();
    this.pinnedNodes.set(new Map());
    this.updatePinStyles();
  }

  toggleNodePin(id: string): void {
    const position = this.boxPositions.get(id);
    if (position == null) return;
    this.cancelPendingLayout();
    const pins = new Map(this.pinnedNodes());
    if (pins.has(id)) pins.delete(id);
    else pins.set(id, { ...position });
    this.pinnedNodes.set(pins);
    this.updatePinStyles();
  }

  private handleNodeClick(e: MouseEvent, d: Node): void {
    if (e.defaultPrevented) return;
    if (this.pinMode() || e.shiftKey) this.toggleNodePin(d.id);
    else this.selectedId.set(d.stepId);
  }

  private handleNodeKeydown(e: KeyboardEvent, d: Node): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (this.pinMode() || e.shiftKey) this.toggleNodePin(d.id);
    else this.selectedId.set(d.stepId);
  }

  private cancelPendingLayout(): void {
    this.layoutVersion++;
    this.layoutPending.set(false);
  }

  private updatePinStyles(): void {
    const pins = this.pinnedNodes();
    this.svg
      ?.selectAll<SVGSVGElement, BoxNode>('[data-flow-node]')
      .attr('aria-label', (d) =>
        this.pinMode()
          ? this.translate.get('flow.togglePin', { name: d.name })
          : d.name,
      )
      .attr('aria-pressed', (d) => pins.has(d.id).toString())
      .select('rect')
      .attr('class', (d) =>
        pins.has(d.id)
          ? 'cursor-pointer stroke-brand-400'
          : 'cursor-pointer hover:stroke-brand-400 stroke-gray-700',
      )
      .attr('stroke-width', (d) => (pins.has(d.id) ? 2.5 : 1));
    this.svg
      ?.selectAll<SVGSVGElement, BoxNode>('[data-flow-node]')
      .select('[data-pin-marker]')
      .style('display', (d) => (pins.has(d.id) ? null : 'none'));
  }

  rebuildSankey(flowData: FlowData, flowSettings: FlowSettings): void {
    let layout = this.getLayout(flowSettings.sankeyAlign, 1, 1);
    let skGraph = this.getGraph(layout, flowData);
    const columns = Math.max(...skGraph.nodes.map((d) => coalesce(d.depth, 0)));
    const width = (columns + 1) * NODE_WIDTH + columns * NODE_WIDTH * 3;
    const height = Math.min(this.height, width * 0.75);
    layout = this.getLayout(flowSettings.sankeyAlign, width, height);
    skGraph = this.getGraph(layout, flowData);

    const pins = new Map(
      [...this.pinnedNodes()].filter(([id]) =>
        skGraph.nodes.some((n) => n.id === id),
      ),
    );
    this.pinnedNodes.set(pins);
    const boxes = skGraph.nodes.map((n) => ({ ...n, x: n.x0, y: n.y0 }));
    restoreBoxPins(boxes, flowData, pins);
    this.boxPositions.clear();
    boxes.forEach((box, index) => {
      const n = skGraph.nodes[index];
      const dx = num(box.x) - num(n.x0);
      const dy = num(box.y) - num(n.y0);
      n.x0 = num(n.x0) + dx;
      n.x1 = num(n.x1) + dx;
      n.y0 = num(n.y0) + dy;
      n.y1 = num(n.y1) + dy;
      this.boxPositions.set(n.id, { x: n.x0, y: n.y0 });
    });
    layout.update(skGraph);
    const previousSvg = this.svg?.node();
    const transform =
      pins.size && previousSvg ? zoomTransform(previousSvg) : undefined;
    const viewBox =
      pins.size && previousSvg
        ? (previousSvg.getAttribute('viewBox') ?? `0 0 ${width} ${height}`)
        : `0 0 ${width.toString()} ${height.toString()}`;
    select(`#${SVG_ID} > *`).remove();
    const svg = select(this.svgElement().nativeElement)
      .append('svg')
      .attr('viewBox', viewBox)
      .attr('class', 'min-h-[75dvh]');

    const zoomBehavior = zoom<SVGSVGElement, unknown>().on(
      'zoom',
      this.zoomHandler(svg),
    );
    svg.call(zoomBehavior);

    // Draw links (draw first so nodes are drawn over them)
    const link = svg
      .append('g')
      .attr('fill', 'none')
      .attr('stroke-opacity', 0.6)
      .style('will-change', 'opacity')
      .selectAll('g')
      .data(skGraph.links)
      .join('g')
      .attr('class', 'mix-blend-multiply');

    const path = link
      .append('path')
      .attr('id', (l) => l.index)
      .attr('d', (l) =>
        (l as SankeyLinkExtraProperties).direction === 'forward'
          ? sankeyLinkHorizontal()(l)
          : sankeyLinkLoop(
              coalesce(l.width, 0),
              NODE_WIDTH,
              (l.source as SankeyNode<Node, Link>).y1,
              (l.target as SankeyNode<Node, Link>).y1,
            )(l),
      )
      .attr('stroke', (l) => l.color)
      .attr('stroke-width', (l) => Math.max(1, coalesce(l.width, 0)));

    svg
      .append('g')
      .selectAll('text')
      .data(skGraph.links)
      .join('text')
      .attr(
        'class',
        'fill-white text-xs text-shadow-sm text-shadow-black translate-y-2',
      )
      .append('textPath')
      .attr('startOffset', '4px')
      .attr('href', (l) => `#${l.index.toString()}`)
      .attr('class', 'pointer-events-none')
      .text((l) => l.text);

    // Main node svg
    const recordPosition = (d: SankeyNode<Node, Link>): void => {
      this.boxPositions.set(d.id, { x: num(d.x0), y: num(d.y0) });
      if (this.pinnedNodes().has(d.id)) {
        const moved = new Map(this.pinnedNodes());
        moved.set(d.id, { x: num(d.x0), y: num(d.y0) });
        this.pinnedNodes.set(moved);
      }
    };
    const node = svg
      .append('g')
      .selectAll<SVGSVGElement, SankeyNode<Node, Link>>('svg')
      .data(skGraph.nodes)
      .join('svg')
      .attr('class', 'overflow-visible')
      .attr('x', (d) => coalesce(d.x0, 0))
      .attr('y', (d) => coalesce(d.y0, 0))
      .attr('data-flow-node', (d) => d.id)
      .attr('role', 'button')
      .attr('tabindex', 0)
      .on('click', (e: MouseEvent, d) => {
        this.handleNodeClick(e, d);
      })
      .on('keydown', (e: KeyboardEvent, d) => {
        this.handleNodeKeydown(e, d);
      })
      .call(
        drag<SVGSVGElement, SankeyNode<Node, Link>>()
          .subject((d) => d as SankeyNode<Node, Link>)
          .on('drag', function (this, event: { dy: number; dx: number }, d) {
            const rectY = parseFloat(select(this).attr('y'));
            const rectX = parseFloat(select(this).attr('x'));
            d.y0 = coalesce(d.y0, 0) + event.dy;
            d.y1 = coalesce(d.y1, 0) + event.dy;
            d.x0 = coalesce(d.x0, 0) + event.dx;
            d.x1 = coalesce(d.x1, 0) + event.dx;
            const trX = coalesce(d.x0, 0) - rectX;
            const trY = coalesce(d.y0, 0) - rectY;
            const transform = `translate(${trX.toString()},${trY.toString()})`;
            select(this).attr('transform', transform);

            recordPosition(d);
            layout.update(skGraph);

            // force an update of the path
            path.attr('d', (l) => {
              if ((l as SankeyLinkExtraProperties).direction === 'forward')
                return sankeyLinkHorizontal()(l);

              const source = l.source as SankeyNode<Node, Link>;
              const target = l.target as SankeyNode<Node, Link>;

              return sankeyLinkLoop(
                coalesce(l.width, 0),
                NODE_WIDTH,
                source.y1,
                target.y1,
              )(l);
            });
          }),
      );

    // Node rect
    node
      .append('rect')
      .attr('class', 'cursor-pointer hover:stroke-brand-400 stroke-gray-700')
      .attr('x', 1)
      .attr('y', 1)
      .attr('height', (d) => this.nodeHeight(d))
      .attr('width', (d) => coalesce(d.x1, 0) - coalesce(d.x0, 0))
      .attr('fill', (d) => d.color)
      .append('title')
      .text((d) => d.name);

    // Node image (for rect height >= 16px)
    const imageNode = node.filter((d) => this.nodeHeight(d) >= 32);
    imageNode
      .append('svg')
      .attr('viewBox', (d) => d.icon.viewBox)
      .attr('width', 32)
      .attr('height', 32)
      .attr('x', 4)
      .attr('y', (d) => this.imageOffset(d))
      .append('image')
      .attr('href', (d) => d.icon.file)
      .attr('class', 'pointer-events-none');

    imageNode
      .filter((d) => d.qualityIcon != null)
      .append('svg')
      .attr('viewBox', (d) => coalesce(d.qualityIcon?.viewBox, ''))
      .attr('width', 32)
      .attr('height', 32)
      .attr('x', 4)
      .attr('y', (d) => this.imageOffset(d))
      .append('image')
      .attr('href', 'icons/icons.webp')
      .attr('class', 'pointer-events-none');

    const recipeIcon = imageNode.filter(
      (d) => d.recipeIcon != null,
    ) as Selection<
      SVGSVGElement,
      SankeyNode<Node, Link> & { recipeIcon: IconData },
      SVGGElement,
      unknown
    >;

    // Add recipe rect
    recipeIcon
      .append('rect')
      .attr('width', 20)
      .attr('height', 20)
      .attr('ry', 10)
      .attr('rx', 10)
      .attr('x', 10)
      .attr('y', (d) => this.imageOffset(d) + 4)
      .attr('class', 'pointer-events-none fill-black blur-[2.5px]');

    // Add recipe image
    recipeIcon
      .append('svg')
      .attr('viewBox', (d) => d.recipeIcon.viewBox)
      .attr('width', 16)
      .attr('height', 16)
      .attr('x', 12)
      .attr('y', (d) => this.imageOffset(d) + 6)
      .append('image')
      .attr('href', (d) => d.recipeIcon.file)
      .attr('class', 'pointer-events-none');

    // Add recipe quality image
    recipeIcon
      .filter((d) => d.recipeQualityIcon != null)
      .append('svg')
      .attr('viewBox', (d) => coalesce(d.recipeQualityIcon?.viewBox, ''))
      .attr('width', 16)
      .attr('height', 16)
      .attr('x', 12)
      .attr('y', (d) => this.imageOffset(d) + 6)
      .append('image')
      .attr('href', 'icons/icons.webp')
      .attr('class', 'pointer-events-none');

    // Add objective id
    recipeIcon
      .filter((d) => d.recipeObjectiveId != null)
      .append('text')
      .attr(
        'class',
        'fill-white text-[6px] text-shadow-md text-shadow-black pointer-events-none',
      )
      .attr('x', 22)
      .attr('y', (d) => this.imageOffset(d) + 22)
      .text((d) => '#' + coalesce(d.recipeObjectiveId, ''));

    // Node text
    node
      .append('text')
      .attr(
        'class',
        'fill-white text-xs text-shadow-md text-shadow-black pointer-events-none',
      )
      .style('text-anchor', 'middle')
      .attr('x', 20)
      .attr('y', (d) => this.imageOffset(d) + 32)
      .text((d) => d.text);

    node
      .append('text')
      .attr('data-pin-marker', '')
      .attr('class', 'pointer-events-none fill-brand-400 text-xs')
      .attr('x', 2)
      .attr('y', 12)
      .text('📌');
    this.svg = svg;
    this.updatePinStyles();
    if (transform)
      svg.call((s) => {
        zoomBehavior.transform(s, transform);
      });
  }

  async rebuildBoxLine(
    flow: FlowData,
    flowSettings: FlowSettings,
  ): Promise<void> {
    const version = ++this.layoutVersion;
    const ids = new Set(flow.nodes.map((n) => n.id));
    const pins = new Map([...this.pinnedNodes()].filter(([id]) => ids.has(id)));
    this.pinnedNodes.set(pins);
    const graph = createBoxGraph(
      flow,
      flowSettings.elkAlgorithm,
      this.boxPositions,
      pins,
      this.layoutSeed,
    );
    this.layoutPending.set(true);
    this.layoutError.set(false);
    let result: ElkNode;
    try {
      result = await this.elk.layout(graph);
    } catch {
      if (version === this.layoutVersion) this.layoutError.set(true);
      return;
    } finally {
      if (version === this.layoutVersion) this.layoutPending.set(false);
    }
    if (
      version !== this.layoutVersion ||
      result.children == null ||
      result.edges == null ||
      result.width == null ||
      result.height == null
    )
      return;

    const boxes = result.children as BoxNode[];
    restoreBoxPins(boxes, flow, pins);
    spaceBoxLayout(
      boxes,
      flow,
      pins,
      flowSettings.gridSnap,
      flowSettings.compactLayout,
    );
    this.pinnedNodes.set(new Map(pins));
    this.boxPositions.clear();
    for (const box of boxes) {
      this.boxPositions.set(box.id, { x: box.x ?? 0, y: box.y ?? 0 });
    }
    const previousSvg = this.svg?.node();
    const transform =
      pins.size && previousSvg ? zoomTransform(previousSvg) : undefined;
    if (!pins.size || this.currentBoxViewBox == null)
      this.currentBoxViewBox = boxViewBox(boxes);
    select(`#${SVG_ID} > *`).remove();
    const displayedFlow = flowSettings.seriesRouting
      ? this.flowBuilder.seriesFlow(flow, this.boxPositions)
      : flow;
    const edges = displayedFlow.links.map(
      (l, index): BoxEdge =>
        spread<BoxEdge>(l as unknown as BoxEdge, {
          id: `${l.source}|${l.target}|${index}`,
          sourceNode: boxes.find((b) => b.id === l.source),
          targetNode: boxes.find((b) => b.id === l.target),
        }),
    );

    const svg = select(this.svgElement().nativeElement)
      .append('svg')
      .attr('viewBox', this.currentBoxViewBox)
      .attr('class', 'min-h-[75dvh]');

    const zoomBehavior = zoom<SVGSVGElement, unknown>().on(
      'zoom',
      this.zoomHandler(svg),
    );
    svg.call(zoomBehavior);

    if (flowSettings.gridSnap) {
      const [x, y, width, height] = this.currentBoxViewBox
        .split(' ')
        .map(Number);
      svg
        .append('defs')
        .append('pattern')
        .attr('id', 'box-grid')
        .attr('data-box-grid-pattern', '')
        .attr('width', BOX_SIZE)
        .attr('height', BOX_SIZE)
        .attr('patternUnits', 'userSpaceOnUse')
        .append('path')
        .attr('d', `M ${BOX_SIZE} 0 L 0 0 0 ${BOX_SIZE}`)
        .attr('fill', 'none')
        .attr('class', 'stroke-gray-500')
        .attr('stroke-width', 0.5);
      svg
        .append('rect')
        .attr('data-box-grid', '')
        .attr('x', x)
        .attr('y', y)
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'url(#box-grid)')
        .attr('class', 'pointer-events-none');
    }
    // Draw edges (draw first so nodes are drawn over them)
    const edge = svg
      .append('g')
      .attr('fill', 'none')
      .style('will-change', 'opacity')
      .selectAll('g')
      .data(edges)
      .join('g')
      .attr('class', 'mix-blend-multiply')
      .attr('data-flow-link', (e) => e.itemId ?? '')
      .attr('data-source', (e) => e.source)
      .attr('data-target', (e) => e.target);

    svg
      .append('defs')
      .selectAll('marker')
      .data(edges)
      .join('marker')
      .attr('id', (e) => `arrow-${e.id}`)
      .attr('viewBox', [0, 0, 640, 640])
      .attr('refX', 320)
      .attr('refY', 320)
      .attr('markerUnits', 'userSpaceOnUse')
      .attr('markerWidth', 12)
      .attr('markerHeight', 12)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr(
        'd',
        'M187.2 100.9C174.8 94.1 159.8 94.4 147.6 101.6C135.4 108.8 128 121.9 128 136L128 504C128 518.1 135.5 531.2 147.6 538.4C159.7 545.6 174.8 545.9 187.2 539.1L523.2 355.1C536 348.1 544 334.6 544 320C544 305.4 536 291.9 523.2 284.9L187.2 100.9z',
      )
      .attr('fill', (e) => e.color);

    const useBeltLines = (e: BoxEdge): boolean =>
      flowSettings.linkText === LinkValue.Belts && e.beltCount != null;
    const beltLayouts: Record<
      string,
      ReturnType<typeof beltLines>
    > = Object.fromEntries(
      edges.filter(useBeltLines).map((e) => [e.id, beltLines(e)]),
    );
    const beltPath = edge
      .filter(useBeltLines)
      .attr('data-belt-count', (e) => num(e.beltCount))
      .attr('data-belts-per-line', (e) => beltLayouts[e.id].multiplier)
      .append('path')
      .attr('data-belt-lines', '')
      .attr('d', (e) => beltLayouts[e.id].path)
      .attr('stroke', (e) => e.color)
      .attr('stroke-width', (e) => beltLayouts[e.id].width);
    const describeLink = (e: BoxEdge): string =>
      [
        e.description,
        useBeltLines(e)
          ? this.translate.get('flow.beltLinesTitle', {
              count: num(e.beltCount),
              throughput: e.text,
              multiplier: beltLayouts[e.id].multiplier,
            })
          : e.text,
      ]
        .filter(Boolean)
        .join('\n');
    const titles = edge.append('title').text(describeLink);

    const path = edge
      .append('path')
      .attr('d', (e) => boxEdgeLine(5)(e))
      .attr('stroke', (e) => e.color)
      .attr('stroke-width', (e) => (useBeltLines(e) ? 0 : 2))
      .attr('marker-end', (e) => `url(#arrow-${e.id})`);
    const textPath = edge
      .append('path')
      .attr('id', (e) => e.id)
      .attr('d', (e) => boxEdgeLine(0, true)(e));

    const linkLabel = (e: BoxEdge): string =>
      useBeltLines(e)
        ? beltLayouts[e.id].multiplier > 1
          ? `×${beltLayouts[e.id].multiplier}`
          : ''
        : e.text;
    const labels = svg
      .append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .attr('dy', '-2px')
      .attr(
        'class',
        'fill-gray-50 text-[6px] text-shadow-md text-shadow-gray-950',
      )
      .append('textPath')
      .attr('startOffset', '50%')
      .style('text-anchor', 'middle')
      .attr('href', (e) => `#${e.id}`)
      .attr('class', 'pointer-events-none')
      .text(linkLabel);

    const redrawLinks = (): void => {
      if (flowSettings.seriesRouting) {
        const routed = this.flowBuilder.seriesFlow(flow, this.boxPositions);
        edges.forEach((edge, i) => {
          const link = routed.links[i];
          Object.assign(edge, link, {
            sourceNode: boxes.find((b) => b.id === link.source),
            targetNode: boxes.find((b) => b.id === link.target),
          });
        });
      }
      edges.filter(useBeltLines).forEach((e) => {
        beltLayouts[e.id] = beltLines(e);
      });
      edge
        .attr('data-source', (e) => e.source)
        .attr('data-target', (e) => e.target);
      edge
        .filter(useBeltLines)
        .attr('data-belt-count', (e) => num(e.beltCount))
        .attr('data-belts-per-line', (e) => beltLayouts[e.id].multiplier);
      beltPath
        .attr('d', (e) => beltLayouts[e.id].path)
        .attr('stroke-width', (e) => beltLayouts[e.id].width);
      path.attr('d', (e) => boxEdgeLine(5)(e));
      textPath.attr('d', (e) => boxEdgeLine(0, true)(e));
      labels.text(linkLabel);
      titles.text(describeLink);
    };

    const recordPosition = (id: string, position: BoxPosition): void => {
      this.cancelPendingLayout();
      this.boxPositions.set(id, position);
      if (this.pinnedNodes().has(id)) {
        const pins = new Map(this.pinnedNodes());
        pins.set(id, position);
        this.pinnedNodes.set(pins);
      }
    };
    const dropPosition = (d: BoxNode, desired: BoxPosition): BoxPosition =>
      flowSettings.gridSnap || flowSettings.compactLayout
        ? boxDropPosition(
            desired,
            boxes
              .filter((b) => b.id !== d.id)
              .map((b) => ({ x: num(b.x), y: num(b.y) })),
            flowSettings.gridSnap,
          )
        : desired;
    // Main node svg
    const node = svg
      .append('g')
      .selectAll<SVGSVGElement, unknown>('svg')
      .data(boxes)
      .join('svg')
      .attr('class', 'overflow-visible')
      .attr('width', 38)
      .attr('height', 38)
      .attr('x', (d) => coalesce(d.x, 0))
      .attr('y', (d) => coalesce(d.y, 0))
      .attr('data-box-node', (d) => d.id)
      .attr('data-flow-node', (d) => d.id)
      .attr('role', 'button')
      .attr('tabindex', 0)
      .attr('aria-label', (d) => d.name)
      .on('click', (e: MouseEvent, d) => {
        this.handleNodeClick(e, d);
      })
      .on('keydown', (e: KeyboardEvent, d) => {
        this.handleNodeKeydown(e, d);
      })
      .call(
        drag<SVGSVGElement, Node & ElkNode>()
          .subject((d) => d as Node & ElkNode)
          .on(
            'drag',
            function (
              this,
              event: { dy: number; dx: number; x: number; y: number },
              d,
            ) {
              const position = dropPosition(d, { x: event.x, y: event.y });
              d.x = position.x;
              d.y = position.y;
              select(this).attr('x', d.x).attr('y', d.y);
              recordPosition(d.id, { x: d.x, y: d.y });
              redrawLinks();
            },
          ),
      );

    // Node rect
    node
      .append('rect')
      .attr('class', 'cursor-pointer hover:stroke-brand-400 stroke-gray-700')
      .attr('x', flowSettings.compactLayout ? 0.5 : 1)
      .attr('y', flowSettings.compactLayout ? 0.5 : 1)
      .attr('ry', flowSettings.compactLayout ? 0 : 2)
      .attr('rx', flowSettings.compactLayout ? 0 : 2)
      .attr('height', flowSettings.compactLayout ? 37 : 36)
      .attr('width', flowSettings.compactLayout ? 37 : 36)
      .attr('fill', (d) => d.color)
      .append('title')
      .text((d) => d.name);

    // Node image
    node
      .append('svg')
      .attr('viewBox', (d) => d.icon.viewBox)
      .attr('width', 32)
      .attr('height', 32)
      .attr('x', 3)
      .attr('y', 3)
      .append('image')
      .attr('href', (d) => d.icon.file)
      .attr('class', 'pointer-events-none');

    // Node quality image
    node
      .filter((d) => d.qualityIcon != null)
      .append('svg')
      .attr('viewBox', (d) => coalesce(d.qualityIcon?.viewBox, ''))
      .attr('width', 32)
      .attr('height', 32)
      .attr('x', -5)
      .attr('y', 9)
      .append('image')
      .attr('href', (d) => d.icon.file)
      .attr('class', 'pointer-events-none');

    // Filter nodes with recipeIcon
    const recipeIcon = node.filter((d) => d.recipeIcon != null) as Selection<
      SVGSVGElement,
      BoxNode & { recipeIcon: IconData },
      SVGGElement,
      unknown
    >;

    // Add recipe rect
    recipeIcon
      .append('rect')
      .attr('width', 20)
      .attr('height', 20)
      .attr('ry', 10)
      .attr('rx', 10)
      .attr('x', 9)
      .attr('y', 9)
      .attr('class', 'pointer-events-none fill-black blur-[2.5px]');

    // Add recipe image
    recipeIcon
      .append('svg')
      .attr('viewBox', (d) => d.recipeIcon.viewBox)
      .attr('width', 16)
      .attr('height', 16)
      .attr('x', 11)
      .attr('y', 11)
      .append('image')
      .attr('href', (d) => d.recipeIcon.file)
      .attr('class', 'pointer-events-none');

    // Add recipe quality image
    recipeIcon
      .filter((d) => d.recipeQualityIcon != null)
      .append('svg')
      .attr('viewBox', (d) => coalesce(d.recipeQualityIcon?.viewBox, ''))
      .attr('width', 16)
      .attr('height', 16)
      .attr('x', 8)
      .attr('y', 14)
      .append('image')
      .attr('href', (d) => d.icon.file)
      .attr('class', 'pointer-events-none');

    // Add objective id
    recipeIcon
      .filter((d) => d.recipeObjectiveId != null)
      .append('text')
      .attr(
        'class',
        'fill-white text-[6px] text-shadow-md text-shadow-black pointer-events-none',
      )
      .attr('y', 26)
      .attr('x', 21)
      .text((d) => '#' + coalesce(d.recipeObjectiveId, ''));

    // Node text
    node
      .append('text')
      .attr(
        'class',
        'fill-white text-[6px] text-shadow-md text-shadow-black pointer-events-none',
      )
      .style('text-anchor', 'middle')
      .attr('y', 35)
      .attr('x', 19)
      .text((d) => d.text);

    node
      .append('svg')
      .attr('data-pin-marker', '')
      .attr('viewBox', `0 0 ${faThumbtack.icon[0]} ${faThumbtack.icon[1]}`)
      .attr('width', 12)
      .attr('height', 12)
      .attr('x', 28)
      .attr('y', -5)
      .attr('class', 'pointer-events-none fill-brand-400')
      .append('path')
      .attr('d', faThumbtack.icon[4] as string);
    this.svg = svg;
    this.updatePinStyles();
    if (transform)
      svg.call((s) => {
        zoomBehavior.transform(s, transform);
      });
  }

  private getLayout(
    align: SankeyAlign,
    width: number,
    height: number,
  ): SankeyLayout<SankeyGraphMinimal<Node, Link>, Node, Link> {
    const layout = sankey<Node, Link>()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_WIDTH)
      .nodeAlign(this._alignMap[align])
      .extent([
        [1, 5],
        [width - 1, height - 5],
      ]);
    if (this.layoutSeed > 1) {
      const rank = (id: string): number => {
        let hash = this.layoutSeed * 2654435761;
        for (const char of id)
          hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        return hash >>> 0;
      };
      layout.nodeSort((a, b) => rank(a.id) - rank(b.id));
    }
    return layout;
  }

  private getGraph(
    layout: SankeyLayout<SankeyGraphMinimal<Node, Link>, Node, Link>,
    data: FlowData,
  ): SankeyGraph<Node, Link> {
    return layout({
      nodes: data.nodes
        .filter((n) =>
          data.links.some((l) => l.source === n.id || l.target === n.id),
        )
        .map((d) => spread(d)),
      links: data.links.map((l) => spread(l)),
    });
  }

  private readonly _alignMap: Record<
    SankeyAlign,
    (node: SankeyNode<Node, Link>, n: number) => number
  > = {
    [SankeyAlign.Left]: sankeyLeft,
    [SankeyAlign.Right]: sankeyRight,
    [SankeyAlign.Center]: sankeyCenter,
    [SankeyAlign.Justify]: sankeyJustify,
  };

  private nodeHeight(d: SankeyNode<Node, Link>): number {
    return coalesce(d.y1, 0) - coalesce(d.y0, 0);
  }

  private imageOffset(d: SankeyNode<Node, Link>): number {
    return (num(d.y1) - num(d.y0)) / 2 - 32 / 2;
  }

  private zoomHandler(
    svg: Selection<SVGSVGElement, unknown, null, undefined>,
  ): (e: { transform: string }) => void {
    return (e: { transform: string }) => {
      svg.selectAll('svg > g').attr('transform', e.transform);
      svg
        .select('[data-box-grid-pattern]')
        .attr('patternTransform', e.transform);
    };
  }
}
