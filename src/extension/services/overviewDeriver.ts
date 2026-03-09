/**
 * 从 RequirementSpec 纯函数派生 OverviewData，无副作用，可独立测试
 */
import type { RequirementSpec, OverviewData } from '@shared/types';

/** 从 RequirementSpec 本地派生 OverviewData（纯函数） */
export function deriveOverview(spec: RequirementSpec): OverviewData {
  const scalarFields: (keyof RequirementSpec)[] = [
    'projectName', 'projectDescription', 'mcu', 'power', 'communication',
    'display', 'sensors', 'costRange', 'sizeLimit', 'productionIntent',
    'powerConsumption', 'precision', 'additionalNotes',
  ];

  let filled = 0;
  let userProvided = 0;
  let aiInferred = 0;

  for (const key of scalarFields) {
    const field = spec[key] as { value: unknown; source: string };
    if (field.value !== null && field.value !== undefined) {
      filled++;
      if (field.source === 'user_provided') userProvided++;
      else aiInferred++;
    }
  }

  const totalFields = scalarFields.length;
  const readiness = Math.round((filled / totalFields) * 100);

  // 收集关键组件
  const keyComponents: string[] = [];
  if (spec.mcu.value) keyComponents.push(spec.mcu.value);
  if (spec.display.value) keyComponents.push(spec.display.value);
  if (spec.sensors.value) keyComponents.push(...spec.sensors.value);
  if (spec.communication.value) keyComponents.push(...spec.communication.value);

  // 风险评估
  const risks: string[] = [];
  if (!spec.mcu.value) risks.push('MCU 未确定，后续 BOM/原理图无法推进');
  if (!spec.power.value) risks.push('供电方案未明确，影响整体设计');
  if (spec.openQuestions.filter(q => q.priority === 'critical').length > 0) {
    risks.push(`存在 ${spec.openQuestions.filter(q => q.priority === 'critical').length} 个关键待确认问题`);
  }

  // 下一步
  const nextSteps: string[] = [];
  if (spec.openQuestions.length > 0) nextSteps.push('回答开放问题以提高需求完整度');
  if (filled < totalFields) nextSteps.push('补充缺失的需求字段');
  nextSteps.push('确认需求后进入 BOM 选型阶段');

  return {
    projectSummary: spec.projectDescription.value ?? spec.projectName.value ?? '未命名项目',
    readinessScore: readiness,
    totalFields,
    filledFields: filled,
    userProvidedCount: userProvided,
    aiInferredCount: aiInferred,
    modules: spec.functionalModules,
    keyComponents,
    risks,
    openQuestions: spec.openQuestions,
    nextSteps,
  };
}
