import { ElkAlgorithm } from './elk-algorithm';
import { FlowDiagram } from './flow-diagram';
import { LinkValue } from './link-value';
import { SankeyAlign } from './sankey-align';

export interface FlowSettings {
  diagram: FlowDiagram;
  linkSize: LinkValue;
  linkText: LinkValue;
  sankeyAlign: SankeyAlign;
  hideExcluded: boolean;
  elkAlgorithm: ElkAlgorithm;
  gridSnap: boolean;
  compactLayout: boolean;
}

export const initialFlowSettings: FlowSettings = {
  diagram: FlowDiagram.Sankey,
  linkSize: LinkValue.Items,
  linkText: LinkValue.Items,
  sankeyAlign: SankeyAlign.Justify,
  hideExcluded: false,
  elkAlgorithm: 'layered',
  gridSnap: false,
  compactLayout: false,
};
