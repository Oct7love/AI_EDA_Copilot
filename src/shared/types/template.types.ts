import type { FormInputData } from './input.types';

/** 项目模板定义 */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  prefilledData: Partial<FormInputData>;
}
