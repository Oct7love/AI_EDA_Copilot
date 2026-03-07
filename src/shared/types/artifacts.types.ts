/** 领域产物类型 — 对齐 BACKEND_STRUCTURE.md §4.2 */

export type FieldSource = 'user_provided' | 'ai_inferred';

export type FieldStatus = 'confirmed' | 'pending_confirmation';

export interface RequirementField<T = string> {
  value: T | null;
  source: FieldSource;
  status: FieldStatus;
  confidence: number;
  note?: string;
}

export type QuestionPriority = 'critical' | 'important' | 'optional';

export interface OpenQuestion {
  id: string;
  question: string;
  context: string;
  priority: QuestionPriority;
  resolved: boolean;
  answer?: string;
}

export interface FunctionalModule {
  name: string;
  description: string;
  components: string[];
  priority: 'core' | 'optional';
}

export interface RequirementSpec {
  // 元数据
  projectName: RequirementField;
  createdAt: string;
  source: 'natural_language' | 'code_analysis' | 'template' | 'form';
  rawInput: string;

  // 核心需求
  projectDescription: RequirementField;
  mcu: RequirementField;
  power: RequirementField;
  communication: RequirementField<string[]>;
  display: RequirementField;
  sensors: RequirementField<string[]>;

  // 扩展需求
  costRange: RequirementField;
  sizeLimit: RequirementField;
  productionIntent: RequirementField;
  powerConsumption: RequirementField;
  precision: RequirementField;
  additionalNotes: RequirementField;

  // 结构化分析
  functionalModules: FunctionalModule[];
  openQuestions: OpenQuestion[];
}

export interface OverviewData {
  projectSummary: string;
  readinessScore: number;
  totalFields: number;
  filledFields: number;
  userProvidedCount: number;
  aiInferredCount: number;
  modules: FunctionalModule[];
  keyComponents: string[];
  risks: string[];
  openQuestions: OpenQuestion[];
  nextSteps: string[];
}
