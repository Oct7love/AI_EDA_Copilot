/** 分析请求：三种输入方式统一输出的标准化数据 */
export interface AnalysisRequest {
  inputType: 'natural_language' | 'form' | 'template' | 'code_analysis';
  rawText?: string;
  formData?: FormInputData;
  templateId?: string;
  codeContext?: CodeAnalysisResult;
  timestamp: string;
}

/** 表单模式的结构化输入 */
export interface FormInputData {
  projectName: string;
  mcu: string;
  power: string;
  communication: string[];
  display: string;
  sensors: string[];
  costRange: string;
  sizeLimit: string;
  productionIntent: 'prototype' | 'small_batch' | 'mass' | '';
  powerConsumption: string;
  precision: string;
  additionalNotes: string;
}

/** 代码分析结果（Phase 8 实现，此处预定义类型） */
export interface CodeAnalysisResult {
  language: 'c' | 'cpp' | 'python';
  detectedGpios: GpioUsage[];
  detectedLibraries: string[];
  detectedPeripherals: string[];
  ambiguousReferences: AmbiguousRef[];
}

export interface GpioUsage {
  pin: string;
  direction: 'input' | 'output' | 'unknown';
  usage: string;
}

export interface AmbiguousRef {
  reference: string;
  possibleMeanings: string[];
  question: string;
}

/** 创建空白表单数据 */
export function createEmptyFormData(): FormInputData {
  return {
    projectName: '',
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
  };
}
