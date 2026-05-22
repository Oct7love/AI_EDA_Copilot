/**
 * InputService.fromCodeAnalysis 单元测试 — 代码上下文序列化
 */
import { describe, it, expect } from 'vitest';
import { InputService } from './InputService';
import type { CodeAnalysisResult } from '@shared/types';

function makeResult(overrides: Partial<CodeAnalysisResult> = {}): CodeAnalysisResult {
  return {
    language: 'cpp',
    detectedGpios: [{ pin: '2', direction: 'output', usage: 'pinMode OUTPUT' }],
    detectedLibraries: ['WiFi.h', 'DHT.h'],
    detectedPeripherals: ['WiFi', 'UART'],
    ambiguousReferences: [
      { reference: 'SENSOR_PIN', possibleMeanings: ['GPIO 引脚号未知'], question: 'q?' },
    ],
    scannedFiles: 3,
    truncated: false,
    ...overrides,
  };
}

describe('InputService.fromCodeAnalysis', () => {
  it('inputType 为 code_analysis 且带 codeContext', () => {
    const req = new InputService().fromCodeAnalysis(makeResult());
    expect(req.inputType).toBe('code_analysis');
    expect(req.codeContext).toBeDefined();
    expect(req.codeContext?.scannedFiles).toBe(3);
  });

  it('rawText 含库/外设/GPIO/模糊引用', () => {
    const req = new InputService().fromCodeAnalysis(makeResult());
    expect(req.rawText).toContain('[代码分析结果');
    expect(req.rawText).toContain('WiFi.h');
    expect(req.rawText).toContain('WiFi, UART');
    expect(req.rawText).toContain('引脚 2 (output)');
    expect(req.rawText).toContain('SENSOR_PIN');
  });

  it('notes 非空时追加补充说明', () => {
    const req = new InputService().fromCodeAnalysis(makeResult(), '这是一个温室监测器');
    expect(req.rawText).toContain('补充说明：这是一个温室监测器');
  });

  it('notes 为空时不追加补充说明', () => {
    const req = new InputService().fromCodeAnalysis(makeResult(), '   ');
    expect(req.rawText).not.toContain('补充说明');
  });

  it('空检测结果仍生成有效 rawText', () => {
    const empty = makeResult({
      detectedGpios: [], detectedLibraries: [], detectedPeripherals: [], ambiguousReferences: [],
    });
    const req = new InputService().fromCodeAnalysis(empty);
    expect(req.rawText).toContain('[代码分析结果');
  });
});
