import type { AnalysisRequest, FormInputData } from '../../shared/types';
import { PROJECT_TEMPLATES } from '../../shared/constants/templates';

/**
 * 输入标准化服务
 * 将三种输入方式统一转换为 AnalysisRequest
 */
export class InputService {
  /** 自然语言 → AnalysisRequest */
  public fromNaturalLanguage(text: string): AnalysisRequest {
    return {
      inputType: 'natural_language',
      rawText: text.trim(),
      timestamp: new Date().toISOString(),
    };
  }

  /** 表单数据 → AnalysisRequest */
  public fromForm(formData: FormInputData): AnalysisRequest {
    const rawText = this._formToText(formData);
    return {
      inputType: 'form',
      rawText,
      formData,
      timestamp: new Date().toISOString(),
    };
  }

  /** 模板选择 → AnalysisRequest（合并用户修改） */
  public fromTemplate(templateId: string, overrides?: Partial<FormInputData>): AnalysisRequest {
    const template = PROJECT_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return this.fromNaturalLanguage(`Template not found: ${templateId}`);
    }

    const formData: FormInputData = {
      projectName: template.name,
      mcu: '',
      power: '',
      communication: [],
      display: '',
      sensors: [],
      costRange: '',
      sizeLimit: '',
      productionIntent: '',
      powerConsumption: '',
      precision: '',
      additionalNotes: '',
      ...template.prefilledData,
      ...overrides,
    };

    return {
      inputType: 'template',
      rawText: this._formToText(formData),
      formData,
      templateId,
      timestamp: new Date().toISOString(),
    };
  }

  /** 将表单数据序列化为可读文本（供 AI prompt 使用） */
  private _formToText(data: FormInputData): string {
    const lines: string[] = [];
    if (data.projectName) lines.push(`Project: ${data.projectName}`);
    if (data.mcu) lines.push(`MCU: ${data.mcu}`);
    if (data.power) lines.push(`Power: ${data.power}`);
    if (data.communication.length > 0) lines.push(`Communication: ${data.communication.join(', ')}`);
    if (data.display) lines.push(`Display: ${data.display}`);
    if (data.sensors.length > 0) lines.push(`Sensors: ${data.sensors.join(', ')}`);
    if (data.costRange) lines.push(`Cost range: ${data.costRange}`);
    if (data.sizeLimit) lines.push(`Size limit: ${data.sizeLimit}`);
    if (data.productionIntent) lines.push(`Production: ${data.productionIntent}`);
    if (data.powerConsumption) lines.push(`Power consumption: ${data.powerConsumption}`);
    if (data.precision) lines.push(`Precision: ${data.precision}`);
    if (data.additionalNotes) lines.push(`Notes: ${data.additionalNotes}`);
    return lines.join('\n');
  }
}
