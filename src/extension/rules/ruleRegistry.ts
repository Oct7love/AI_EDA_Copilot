/**
 * 规则注册表 — 汇总所有 Hard / Warning / JLC 规则
 */
import type { Rule } from '@shared/types';
import { hardRules } from './hardRules';
import { warningRules } from './warningRules';
import { jlcRules } from './jlcRules';

/** 获取全部注册规则 */
export function getAllRules(): Rule[] {
  return [...hardRules, ...warningRules, ...jlcRules];
}

/** 获取所有已启用的规则 */
export function getEnabledRules(): Rule[] {
  return getAllRules().filter((rule) => rule.enabled);
}
