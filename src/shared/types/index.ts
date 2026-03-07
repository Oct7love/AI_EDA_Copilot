/**
 * 共享类型入口
 * Extension 和 Webview 双侧共用
 */

export type { PipelineStage, ReportSection } from './pipeline.types';

export type {
  MessageSource,
  BaseMessage,
  PanelToExtension,
  ExtensionToPanel,
  ExtensionToReport,
  ReportToExtension,
} from './messages.types';

export { createMessage } from './messages.types';

export type {
  AnalysisRequest,
  FormInputData,
  CodeAnalysisResult,
  GpioUsage,
  AmbiguousRef,
} from './input.types';

export { createEmptyFormData } from './input.types';

export type { ProjectTemplate } from './template.types';

export type {
  AiMessage,
  AiCompletionParams,
  AiStreamChunk,
  AiErrorCode,
  RetryState,
} from './ai.types';

export { RETRYABLE_ERRORS, createRetryState } from './ai.types';

export type {
  FieldSource,
  FieldStatus,
  RequirementField,
  QuestionPriority,
  OpenQuestion,
  FunctionalModule,
  RequirementSpec,
  OverviewData,
} from './artifacts.types';
