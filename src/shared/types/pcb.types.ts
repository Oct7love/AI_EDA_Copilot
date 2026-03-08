/** PCB 布局规划类型 — 对齐 BACKEND_STRUCTURE §4.5 */

export interface PCBLayoutPlan {
  boardSize: {
    width: number;
    height: number;
    source: 'user_provided' | 'ai_inferred';
    status: 'confirmed' | 'pending_confirmation';
    confidence: number;
  };
  layerCount: {
    value: number;
    source: 'user_provided' | 'ai_inferred';
    status: 'confirmed' | 'pending_confirmation';
    confidence: number;
    reasoning: string;
  };
  zones: LayoutZone[];
  placements: ComponentPlacement[];
  routingGuidelines: RoutingGuideline[];
  constraints: LayoutConstraint[];
}

export interface LayoutZone {
  id: string;
  name: string;
  purpose: string;
  relativePosition: string;
  components: string[];
  color?: string;
}

export interface ComponentPlacement {
  designator: string;
  zone: string;
  placementNotes: string;
  priority: 'critical' | 'important' | 'flexible';
}

export interface RoutingGuideline {
  netName: string;
  guideline: string;
  category: 'power' | 'signal' | 'differential' | 'analog';
  severity: 'mandatory' | 'recommended';
}

export interface LayoutConstraint {
  type: 'keep_out' | 'placement' | 'routing' | 'thermal' | 'clearance';
  description: string;
  affectedComponents: string[];
  reference?: string;
}
