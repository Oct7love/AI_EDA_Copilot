# Code Analysis Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户选 Arduino/ESP32 固件代码文件夹，本地扫描器提取 GPIO/库/外设，预览确认后注入现有需求管线生成报告。

**Architecture:** 提取逻辑下沉为无 vscode 依赖的纯函数模块 `arduinoAnalyzer.ts`（对齐 versionStore/artifactParsers 模式，全量单测）；`CodeAnalysisService` 做文件遍历编排；`InputService.fromCodeAnalysis` 把结果序列化进现有需求 prompt；侧边栏新增「代码」输入模式（CodeFolderPicker + CodeAnalysisPreview）。

**Tech Stack:** TypeScript, VS Code Extension API, React 18, Zustand, Vitest, esbuild。

**Spec:** `docs/superpowers/specs/2026-05-21-code-analysis-input-design.md`

---

## 前置：工作区隔离

执行前用 `superpowers:using-git-worktrees` 创建隔离工作区（CLAUDE.md §15.1）：

- 分支语义：`feat/phase8/code-analysis-input`（原生 EnterWorktree 会按自身规则命名，功能等价即可）
- 基点：`main` 当前 HEAD（含本设计与计划文档）
- 若原生 worktree 工具从 `origin` 分支导致缺本地未 push 提交，建完后 `git log` 核对、必要时 `git reset --hard main`（见项目备忘）。

所有任务在该 worktree 内执行。`node -v` 应为 v20.x。baseline：`npm test` 应 136 测试全绿。

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/extension/analyzers/arduinoAnalyzer.ts` | 纯函数：Arduino 代码提取库/GPIO/外设/模糊引用 |
| 新建 | `src/extension/analyzers/arduinoAnalyzer.test.ts` | arduinoAnalyzer 单元测试 |
| 新建 | `src/extension/services/CodeAnalysisService.ts` | 编排：遍历文件夹收集源码 → 调 arduinoAnalyzer |
| 新建 | `src/extension/services/InputService.test.ts` | InputService.fromCodeAnalysis 测试 |
| 新建 | `src/webview/panel/components/CodeFolderPicker.tsx` + `.css` | 选文件夹入口（idle/scanning/failed） |
| 新建 | `src/webview/panel/components/CodeAnalysisPreview.tsx` + `.css` | 扫描结果预览 + 确认注入 |
| 修改 | `src/shared/types/input.types.ts` | `CodeAnalysisResult` 加 `scannedFiles`/`truncated` |
| 修改 | `src/shared/types/messages.types.ts` | 新增 4 个消息类型 |
| 修改 | `src/extension/services/InputService.ts` | `fromCodeAnalysis` + `_codeContextToText` |
| 修改 | `src/extension/prompts/requirementPrompt.ts` | SYSTEM_PROMPT 加代码上下文规则 |
| 修改 | `src/extension/activate.ts` | 2 个 handler + 实例化 CodeAnalysisService |
| 修改 | `src/webview/panel/store/inputStore.ts` | `InputMode` 加 'code' + 代码分析状态 |
| 修改 | `src/webview/panel/components/InputModeToggle.tsx` | 第三段「Code」 |
| 修改 | `src/webview/panel/PanelApp.tsx` | code 模式渲染 + 2 条消息处理 |

---

## Task 1: 类型层 — CodeAnalysisResult 扩展

**Files:** Modify `src/shared/types/input.types.ts`

- [ ] **Step 1: 给 CodeAnalysisResult 加两个展示字段**

在 `src/shared/types/input.types.ts` 中，将：

```ts
/** 代码分析结果（Phase 8 实现，此处预定义类型） */
export interface CodeAnalysisResult {
  language: 'c' | 'cpp' | 'python';
  detectedGpios: GpioUsage[];
  detectedLibraries: string[];
  detectedPeripherals: string[];
  ambiguousReferences: AmbiguousRef[];
}
```

替换为：

```ts
/** 代码分析结果 */
export interface CodeAnalysisResult {
  language: 'c' | 'cpp' | 'python';   // V1 恒为 'cpp'（Arduino）
  detectedGpios: GpioUsage[];
  detectedLibraries: string[];
  detectedPeripherals: string[];
  ambiguousReferences: AmbiguousRef[];
  scannedFiles: number;               // 实际扫描的文件数（预览显示）
  truncated: boolean;                 // 是否因文件数/体积上限被截断
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误。`CodeAnalysisResult` 当前无任何构造点，新增必填字段不破坏现有代码。`index.ts` 已 re-export 该类型，无需改动）。

- [ ] **Step 3: Commit**

```bash
git add src/shared/types/input.types.ts
git commit -m "feat(code-analysis): CodeAnalysisResult 增加 scannedFiles/truncated 字段"
```

---

## Task 2: arduinoAnalyzer 纯逻辑模块 + 单测（TDD）

**Files:**
- Create: `src/extension/analyzers/arduinoAnalyzer.ts`
- Test: `src/extension/analyzers/arduinoAnalyzer.test.ts`

- [ ] **Step 1: 写失败测试** — create `src/extension/analyzers/arduinoAnalyzer.test.ts`:

```ts
/**
 * arduinoAnalyzer 单元测试 — Arduino 代码启发式扫描纯函数
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeArduinoCode,
  stripComments,
  buildSymbolTable,
  extractLibraries,
  extractGpios,
  extractPeripherals,
  type SourceFile,
} from './arduinoAnalyzer';

function file(content: string, path = 'sketch.ino'): SourceFile {
  return { path, content };
}

describe('stripComments', () => {
  it('移除行注释与块注释', () => {
    const out = stripComments('a // line\nb /* block */ c');
    expect(out).not.toContain('line');
    expect(out).not.toContain('block');
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
  });
});

describe('buildSymbolTable', () => {
  it('收录 #define 引脚字面量', () => {
    const t = buildSymbolTable('#define LED_PIN 2');
    expect(t.get('LED_PIN')).toBe('2');
  });
  it('收录 const int 引脚字面量', () => {
    const t = buildSymbolTable('const int DHT = 4;');
    expect(t.get('DHT')).toBe('4');
  });
  it('解析一次跳转（#define B A）', () => {
    const t = buildSymbolTable('#define A 5\n#define B A');
    expect(t.get('B')).toBe('5');
  });
  it('值为表达式的不收录', () => {
    const t = buildSymbolTable('#define X (1 + 2)');
    expect(t.has('X')).toBe(false);
  });
});

describe('extractLibraries', () => {
  it('提取 #include 并去重排序', () => {
    const libs = extractLibraries('#include <WiFi.h>\n#include "DHT.h"\n#include <WiFi.h>');
    expect(libs).toEqual(['DHT.h', 'WiFi.h']);
  });
  it('过滤系统头', () => {
    const libs = extractLibraries('#include <Arduino.h>\n#include <stdint.h>\n#include <WiFi.h>');
    expect(libs).toEqual(['WiFi.h']);
  });
});

describe('extractGpios', () => {
  it('pinMode OUTPUT + 字面量引脚 → output', () => {
    const { gpios } = extractGpios('pinMode(2, OUTPUT);', new Map());
    expect(gpios).toHaveLength(1);
    expect(gpios[0].pin).toBe('2');
    expect(gpios[0].direction).toBe('output');
  });
  it('analogRead(A0) → A0 input', () => {
    const { gpios } = extractGpios('analogRead(A0);', new Map());
    expect(gpios[0].pin).toBe('A0');
    expect(gpios[0].direction).toBe('input');
  });
  it('经符号表解析宏引脚', () => {
    const { gpios } = extractGpios('pinMode(DHT, INPUT);', new Map([['DHT', '4']]));
    expect(gpios[0].pin).toBe('4');
    expect(gpios[0].direction).toBe('input');
  });
  it('方向冲突合并为 unknown', () => {
    const { gpios } = extractGpios('pinMode(5, OUTPUT);\ndigitalRead(5);', new Map());
    expect(gpios[0].pin).toBe('5');
    expect(gpios[0].direction).toBe('unknown');
  });
  it('无法解析的标识符引脚 → GpioUsage + AmbiguousRef', () => {
    const { gpios, ambiguous } = extractGpios('pinMode(SENSOR_PIN, INPUT);', new Map());
    expect(gpios[0].pin).toBe('SENSOR_PIN');
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].reference).toBe('SENSOR_PIN');
  });
  it('attachInterrupt 经 digitalPinToInterrupt → input', () => {
    const { gpios } = extractGpios('attachInterrupt(digitalPinToInterrupt(12), isr, RISING);', new Map());
    expect(gpios[0].pin).toBe('12');
    expect(gpios[0].direction).toBe('input');
  });
});

describe('extractPeripherals', () => {
  it('检测 I2C / SPI / UART / WiFi', () => {
    const code = 'Wire.begin();\nSPI.begin();\nSerial.begin(115200);\nWiFi.begin(ssid, pwd);';
    const p = extractPeripherals(code);
    expect(p).toContain('I2C');
    expect(p).toContain('SPI');
    expect(p).toContain('UART');
    expect(p).toContain('WiFi');
  });
});

describe('analyzeArduinoCode', () => {
  it('端到端：ESP32 传感器 sketch', () => {
    const code = `
      #include <WiFi.h>
      #include <DHT.h>
      #define DHT_PIN 4
      #define LED 2
      void setup() {
        Serial.begin(115200);
        pinMode(LED, OUTPUT);
        pinMode(DHT_PIN, INPUT);
      }
      void loop() {
        int v = analogRead(A0);
        digitalWrite(LED, HIGH);
      }`;
    const r = analyzeArduinoCode([file(code)]);
    expect(r.language).toBe('cpp');
    expect(r.detectedLibraries).toEqual(['DHT.h', 'WiFi.h']);
    expect(r.detectedPeripherals).toContain('WiFi');
    expect(r.detectedPeripherals).toContain('UART');
    expect(r.detectedPeripherals).toContain('ADC');
    const pins = r.detectedGpios.map((g) => g.pin);
    expect(pins).toContain('2');   // LED
    expect(pins).toContain('4');   // DHT_PIN
    expect(pins).toContain('A0');
    expect(r.ambiguousReferences).toHaveLength(0);
  });
  it('跨文件符号表：宏定义在 .h，使用在 .ino', () => {
    const header = file('#define MOTOR_PIN 13', 'pins.h');
    const sketch = file('pinMode(MOTOR_PIN, OUTPUT);', 'sketch.ino');
    const r = analyzeArduinoCode([header, sketch]);
    expect(r.detectedGpios[0].pin).toBe('13');
    expect(r.ambiguousReferences).toHaveLength(0);
  });
  it('注释中的代码不被误检', () => {
    const r = analyzeArduinoCode([file('// pinMode(99, OUTPUT);\nvoid loop(){}')]);
    expect(r.detectedGpios).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/extension/analyzers/arduinoAnalyzer.test.ts`
Expected: FAIL — `Failed to resolve import "./arduinoAnalyzer"`。

- [ ] **Step 3: 实现 arduinoAnalyzer.ts** — create `src/extension/analyzers/arduinoAnalyzer.ts`:

```ts
/**
 * Arduino/ESP32 固件代码启发式扫描器 — 纯函数，无 vscode 依赖。
 * 提取库引用 / GPIO 使用 / 外设 / 模糊引用，供 CodeAnalysisService 编排调用。
 */
import type { GpioUsage, AmbiguousRef, CodeAnalysisResult } from '@shared/types';

/** 待分析的源文件 */
export interface SourceFile {
  path: string;
  content: string;
}

/** analyzeArduinoCode 的返回（scannedFiles/truncated 由编排层补） */
export type ArduinoAnalysis = Omit<CodeAnalysisResult, 'scannedFiles' | 'truncated'>;

/** 系统/语言头文件，不计入「检测到的库」 */
const SYSTEM_HEADERS = new Set([
  'arduino.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'string.h',
  'string', 'math.h', 'stdbool.h', 'stddef.h', 'inttypes.h',
]);

/** 引脚 token 正则片段：标识符 或 数字 */
const PIN = '([A-Za-z_]\\w*|\\d+)';

/** 去掉块注释与行注释，避免误匹配注释里的示例代码 */
export function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** token 是否引脚字面量（纯数字 或 A0/A1… 形式） */
function isPinLiteral(token: string): boolean {
  return /^\d+$/.test(token) || /^A\d+$/.test(token);
}

/**
 * 收集 #define / const 整型常量，构建 标识符→引脚字面量 映射。
 * 仅收录值为引脚字面量、或可经一次跳转解析到引脚字面量的符号。
 */
export function buildSymbolTable(code: string): Map<string, string> {
  const raw = new Map<string, string>();
  const patterns = [
    /#define\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*|\d+)/g,
    /\bconst(?:expr)?\s+(?:int|uint8_t|byte|short)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*|\d+)\s*;/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      if (!raw.has(m[1])) raw.set(m[1], m[2]);
    }
  }
  const resolved = new Map<string, string>();
  for (const [name, value] of raw) {
    if (isPinLiteral(value)) {
      resolved.set(name, value);
    } else {
      const hop = raw.get(value);
      if (hop && isPinLiteral(hop)) resolved.set(name, hop);
    }
  }
  return resolved;
}

/** 提取 #include 库（去重、排序、过滤系统头） */
export function extractLibraries(code: string): string[] {
  const libs = new Set<string>();
  for (const m of code.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)) {
    const header = m[1].trim();
    if (!SYSTEM_HEADERS.has(header.toLowerCase())) libs.add(header);
  }
  return [...libs].sort();
}

/** 单参引脚 API（如 digitalRead(PIN)）→ 方向 + 标签 */
const READ_APIS: { source: string; label: string }[] = [
  { source: `\\bdigitalRead\\(\\s*${PIN}\\s*\\)`, label: 'digitalRead' },
  { source: `\\banalogRead\\(\\s*${PIN}\\s*\\)`, label: 'analogRead' },
  { source: `\\btouchRead\\(\\s*${PIN}\\s*\\)`, label: 'touchRead' },
];

/** 多参引脚 API（引脚为第一参，如 digitalWrite(PIN, ...)）→ output */
const WRITE_APIS: { source: string; label: string }[] = [
  { source: `\\bdigitalWrite\\(\\s*${PIN}\\s*,`, label: 'digitalWrite' },
  { source: `\\banalogWrite\\(\\s*${PIN}\\s*,`, label: 'analogWrite' },
  { source: `\\bdacWrite\\(\\s*${PIN}\\s*,`, label: 'dacWrite' },
  { source: `\\bledcAttachPin\\(\\s*${PIN}\\s*,`, label: 'ledcAttachPin' },
];

/** 提取 GPIO 使用 + 模糊引用 */
export function extractGpios(
  code: string,
  symbols: Map<string, string>,
): { gpios: GpioUsage[]; ambiguous: AmbiguousRef[] } {
  const acc = new Map<string, { directions: Set<'input' | 'output'>; usages: Set<string> }>();
  const unresolved = new Set<string>();

  const record = (token: string, direction: 'input' | 'output', label: string): void => {
    let pinKey: string;
    let usage = label;
    if (isPinLiteral(token)) {
      pinKey = token;
    } else if (symbols.has(token)) {
      pinKey = symbols.get(token)!;
      usage = `${token} · ${label}`;
    } else {
      pinKey = token;
      usage = `${token} · ${label}`;
      unresolved.add(token);
    }
    let entry = acc.get(pinKey);
    if (!entry) {
      entry = { directions: new Set(), usages: new Set() };
      acc.set(pinKey, entry);
    }
    entry.directions.add(direction);
    entry.usages.add(usage);
  };

  // pinMode(PIN, MODE)
  for (const m of code.matchAll(new RegExp(`\\bpinMode\\(\\s*${PIN}\\s*,\\s*(\\w+)\\s*\\)`, 'g'))) {
    const mode = m[2].toUpperCase();
    if (mode === 'OUTPUT') record(m[1], 'output', `pinMode ${m[2]}`);
    else if (mode.startsWith('INPUT')) record(m[1], 'input', `pinMode ${m[2]}`);
  }

  // attachInterrupt(digitalPinToInterrupt(PIN), ...)
  for (const m of code.matchAll(
    new RegExp(`\\battachInterrupt\\(\\s*digitalPinToInterrupt\\(\\s*${PIN}\\s*\\)`, 'g'),
  )) {
    record(m[1], 'input', 'attachInterrupt');
  }

  for (const { source, label } of READ_APIS) {
    for (const m of code.matchAll(new RegExp(source, 'g'))) record(m[1], 'input', label);
  }
  for (const { source, label } of WRITE_APIS) {
    for (const m of code.matchAll(new RegExp(source, 'g'))) record(m[1], 'output', label);
  }

  const gpios: GpioUsage[] = [...acc.entries()]
    .map(([pin, e]) => {
      let direction: GpioUsage['direction'];
      if (e.directions.size > 1) direction = 'unknown';
      else if (e.directions.has('output')) direction = 'output';
      else direction = 'input';
      return { pin, direction, usage: [...e.usages].join('; ') };
    })
    .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));

  const ambiguous: AmbiguousRef[] = [...unresolved].sort().map((ref) => ({
    reference: ref,
    possibleMeanings: ['GPIO 引脚号未在 #define / const 中找到'],
    question: `代码中 \`${ref}\` 对应的实际 GPIO 引脚号是多少？`,
  }));

  return { gpios, ambiguous };
}

/** 提取外设（由 API 调用 + include 推断规范名） */
export function extractPeripherals(code: string): string[] {
  const found = new Set<string>();
  const rules: { name: string; test: RegExp }[] = [
    { name: 'I2C', test: /\bWire\s*\.|<Wire\.h>/i },
    { name: 'SPI', test: /\bSPI\s*\.|<SPI\.h>/i },
    { name: 'UART', test: /\bSerial\d?\s*\.\s*begin/ },
    { name: 'WiFi', test: /\bWiFi\s*\.|<WiFi\.h>/i },
    { name: 'BLE/蓝牙', test: /\bBLE\w*|BluetoothSerial/ },
    { name: 'PWM', test: /\bledc\w*|\banalogWrite\s*\(/ },
    { name: 'DAC', test: /\bdacWrite\s*\(/ },
    { name: 'ADC', test: /\banalogRead\s*\(/ },
    { name: 'Servo', test: /\bServo\b/ },
  ];
  for (const { name, test } of rules) {
    if (test.test(code)) found.add(name);
  }
  return [...found].sort();
}

/** 主入口：合并所有文件做整体扫描 */
export function analyzeArduinoCode(files: SourceFile[]): ArduinoAnalysis {
  const merged = stripComments(files.map((f) => f.content).join('\n'));
  const symbols = buildSymbolTable(merged);
  const { gpios, ambiguous } = extractGpios(merged, symbols);
  return {
    language: 'cpp',
    detectedGpios: gpios,
    detectedLibraries: extractLibraries(merged),
    detectedPeripherals: extractPeripherals(merged),
    ambiguousReferences: ambiguous,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/extension/analyzers/arduinoAnalyzer.test.ts`
Expected: PASS（全部 17 个用例通过）。

- [ ] **Step 5: Commit**

```bash
git add src/extension/analyzers/arduinoAnalyzer.ts src/extension/analyzers/arduinoAnalyzer.test.ts
git commit -m "feat(code-analysis): arduinoAnalyzer 启发式扫描纯逻辑 + 单元测试"
```

---

## Task 3: 消息协议 — 4 个新消息类型

**Files:** Modify `src/shared/types/messages.types.ts`

- [ ] **Step 1: 引入 CodeAnalysisResult 类型**

在 `src/shared/types/messages.types.ts` 顶部，将：

```ts
import type { FormInputData } from './input.types';
```

替换为：

```ts
import type { FormInputData, CodeAnalysisResult } from './input.types';
```

- [ ] **Step 2: PanelToExtension 新增 2 个消息**

在 `PanelToExtension` 联合类型中，将最后一行：

```ts
  | BaseMessage<'session_rename', { sessionId: string; name: string }>;
```

替换为：

```ts
  | BaseMessage<'session_rename', { sessionId: string; name: string }>
  | BaseMessage<'pick_code_folder', void>
  | BaseMessage<'submit_code_analysis', { result: CodeAnalysisResult; notes: string }>;
```

- [ ] **Step 3: ExtensionToPanel 新增 2 个消息**

在 `ExtensionToPanel` 联合类型中，将最后一行：

```ts
  | BaseMessage<'session_saved', { sessionId: string; name: string }>;
```

替换为：

```ts
  | BaseMessage<'session_saved', { sessionId: string; name: string }>
  | BaseMessage<'code_analysis_result', { result: CodeAnalysisResult }>
  | BaseMessage<'code_analysis_failed', { message: string }>;
```

- [ ] **Step 4: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/messages.types.ts
git commit -m "feat(code-analysis): 新增 pick_code_folder/submit/result/failed 消息类型"
```

---

## Task 4: InputService.fromCodeAnalysis + prompt 规则（TDD）

**Files:**
- Modify: `src/extension/services/InputService.ts`
- Modify: `src/extension/prompts/requirementPrompt.ts`
- Test: `src/extension/services/InputService.test.ts`

- [ ] **Step 1: 写失败测试** — create `src/extension/services/InputService.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/extension/services/InputService.test.ts`
Expected: FAIL — `fromCodeAnalysis` 不存在（`Property 'fromCodeAnalysis' does not exist`）。

- [ ] **Step 3: 实现 fromCodeAnalysis** — in `src/extension/services/InputService.ts`:

将顶部 import：

```ts
import type { AnalysisRequest, FormInputData } from '../../shared/types';
```

替换为：

```ts
import type { AnalysisRequest, FormInputData, CodeAnalysisResult } from '../../shared/types';
```

然后在 `_formToText` 方法之后、类闭合 `}` 之前，新增两个方法：

```ts
  /** 代码分析结果 → AnalysisRequest */
  public fromCodeAnalysis(result: CodeAnalysisResult, notes?: string): AnalysisRequest {
    const codeText = this._codeContextToText(result);
    const trimmed = notes?.trim();
    const rawText = trimmed ? `${codeText}\n\n补充说明：${trimmed}` : codeText;
    return {
      inputType: 'code_analysis',
      rawText,
      codeContext: result,
      timestamp: new Date().toISOString(),
    };
  }

  /** 将代码分析结果序列化为可读文本（供 AI prompt 消费） */
  private _codeContextToText(r: CodeAnalysisResult): string {
    const lines: string[] = ['[代码分析结果 — 来自固件源码扫描]', '语言: Arduino C/C++'];
    if (r.detectedLibraries.length > 0) {
      lines.push(`检测到的库: ${r.detectedLibraries.join(', ')}`);
    }
    if (r.detectedPeripherals.length > 0) {
      lines.push(`检测到的外设: ${r.detectedPeripherals.join(', ')}`);
    }
    if (r.detectedGpios.length > 0) {
      lines.push('检测到的 GPIO 使用:');
      for (const g of r.detectedGpios) {
        lines.push(`- 引脚 ${g.pin} (${g.direction}) — ${g.usage}`);
      }
    }
    if (r.ambiguousReferences.length > 0) {
      lines.push('模糊引用（需用户确认）:');
      for (const a of r.ambiguousReferences) {
        lines.push(`- ${a.reference}: ${a.possibleMeanings.join('; ')}`);
      }
    }
    return lines.join('\n');
  }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/extension/services/InputService.test.ts`
Expected: PASS（5 个用例通过）。

- [ ] **Step 5: requirementPrompt 加代码上下文规则**

在 `src/extension/prompts/requirementPrompt.ts` 的 `SYSTEM_PROMPT` 字符串中，将结尾的：

```ts
7. Be thorough: infer communication protocols, power requirements, sensor types from context`;
```

替换为：

```ts
7. Be thorough: infer communication protocols, power requirements, sensor types from context
8. If the input contains a "[代码分析结果]" block: treat the listed libraries / peripherals / GPIOs as source-code evidence — high confidence (source:"ai_inferred", status:"confirmed", confidence>=0.9). For each item under "模糊引用", add a corresponding entry to openQuestions with priority:"important"`;
```

- [ ] **Step 6: 类型检查 + 回归测试**

Run: `npm run check-types && npm test`
Expected: PASS（零 tsc 错误；全套测试通过 = 136 原有 + 17 arduinoAnalyzer + 5 InputService = 158）。

- [ ] **Step 7: Commit**

```bash
git add src/extension/services/InputService.ts src/extension/services/InputService.test.ts src/extension/prompts/requirementPrompt.ts
git commit -m "feat(code-analysis): InputService.fromCodeAnalysis + 序列化测试 + prompt 规则"
```

---

## Task 5: CodeAnalysisService — 文件遍历编排

**Files:** Create `src/extension/services/CodeAnalysisService.ts`

- [ ] **Step 1: 实现 CodeAnalysisService** — create `src/extension/services/CodeAnalysisService.ts`:

```ts
/**
 * 代码分析编排服务 — 遍历文件夹收集 Arduino 源码 → 调 arduinoAnalyzer。
 * 文件 I/O 与上限控制在此；纯提取逻辑在 analyzers/arduinoAnalyzer.ts。
 */
import * as vscode from 'vscode';
import type { CodeAnalysisResult } from '@shared/types';
import { analyzeArduinoCode, type SourceFile } from '../analyzers/arduinoAnalyzer';

/** Arduino 源码扩展名 */
const CODE_EXTENSIONS = ['.ino', '.c', '.cpp', '.cc', '.h', '.hpp'];
/** 遍历时跳过的目录 */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '.pio', 'out', 'dist']);
/** 扫描上限 */
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/** 文件夹内无 Arduino 源码 */
export class NoArduinoFilesError extends Error {
  constructor() {
    super('未在该文件夹找到 Arduino 代码文件（.ino/.c/.cpp/.h）');
    this.name = 'NoArduinoFilesError';
  }
}

export class CodeAnalysisService {
  /** 遍历文件夹 → 收集源码 → 分析；无源码时抛 NoArduinoFilesError */
  async analyze(folderUri: vscode.Uri): Promise<CodeAnalysisResult> {
    const files: SourceFile[] = [];
    let totalBytes = 0;
    let truncated = false;

    const walk = async (dir: vscode.Uri): Promise<void> => {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
        truncated = true;
        return;
      }
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        return; // 不可读目录跳过
      }
      for (const [name, type] of entries) {
        if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
          truncated = true;
          return;
        }
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          if (!SKIP_DIRS.has(name)) await walk(child);
        } else if (type === vscode.FileType.File) {
          const dot = name.lastIndexOf('.');
          const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
          if (!CODE_EXTENSIONS.includes(ext)) continue;
          try {
            const bytes = await vscode.workspace.fs.readFile(child);
            totalBytes += bytes.byteLength;
            files.push({ path: child.fsPath, content: Buffer.from(bytes).toString('utf-8') });
          } catch {
            // 单文件不可读 → 跳过续扫
          }
        }
      }
    };

    await walk(folderUri);

    if (files.length === 0) {
      throw new NoArduinoFilesError();
    }

    const analysis = analyzeArduinoCode(files);
    return { ...analysis, scannedFiles: files.length, truncated };
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误）。

- [ ] **Step 3: Commit**

```bash
git add src/extension/services/CodeAnalysisService.ts
git commit -m "feat(code-analysis): CodeAnalysisService 文件遍历编排（上限 200 文件/2MB）"
```

---

## Task 6: activate.ts 接线 — 2 个 handler

**Files:** Modify `src/extension/activate.ts`

- [ ] **Step 1: import CodeAnalysisService**

在 `src/extension/activate.ts` 中，将：

```ts
import { SessionManager } from './services/SessionManager';
```

替换为：

```ts
import { SessionManager } from './services/SessionManager';
import { CodeAnalysisService } from './services/CodeAnalysisService';
```

- [ ] **Step 2: 实例化 CodeAnalysisService**

将：

```ts
  const inputService = new InputService();
```

替换为：

```ts
  const inputService = new InputService();
  const codeAnalysisService = new CodeAnalysisService();
```

- [ ] **Step 3: 新增 2 个 handler**

在 `sidePanelProvider.onMessage` 的 `switch (message.type)` 中，找到 `case 'session_rename': { ... }` 块的结尾（`.then(...)` 链后的 `break;`），在其之后、`switch` 闭合 `}` 之前，新增：

```ts
      case 'pick_code_folder': {
        vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: '选择固件代码文件夹',
        }).then((picked) => {
          if (!picked || picked.length === 0) {
            sidePanelProvider.postMessage({
              type: 'code_analysis_failed',
              source: 'extension',
              payload: { message: '未选择文件夹' },
              timestamp: Date.now(),
            });
            return;
          }
          return codeAnalysisService.analyze(picked[0]).then((result) => {
            sidePanelProvider.postMessage({
              type: 'code_analysis_result',
              source: 'extension',
              payload: { result },
              timestamp: Date.now(),
            });
            outputChannel.appendLine(`[code-analysis] scanned ${result.scannedFiles} files`);
          });
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          sidePanelProvider.postMessage({
            type: 'code_analysis_failed',
            source: 'extension',
            payload: { message: msg },
            timestamp: Date.now(),
          });
          outputChannel.appendLine(`[code-analysis] error: ${msg}`);
        });
        break;
      }

      case 'submit_code_analysis': {
        const { result, notes } = message.payload;
        const request = inputService.fromCodeAnalysis(result, notes);
        sessionManager.mirrorUserMessage(`[代码分析] 已导入固件代码，扫描 ${result.scannedFiles} 个文件`);
        outputChannel.appendLine(`[InputService] code_analysis → ${result.scannedFiles} files`);
        pipeline.runRequirementStage(request);
        break;
      }
```

- [ ] **Step 4: 类型检查 + 回归测试**

Run: `npm run check-types && npm test`
Expected: PASS（零 tsc 错误；测试套件不变 158 全绿）。

- [ ] **Step 5: Commit**

```bash
git add src/extension/activate.ts
git commit -m "feat(code-analysis): activate 接线 pick_code_folder + submit_code_analysis handler"
```

---

## Task 7: inputStore — code 模式 + 代码分析状态

**Files:** Modify `src/webview/panel/store/inputStore.ts`

- [ ] **Step 1: 扩展 import 与 InputMode**

将顶部：

```ts
import type { FormInputData, ChatMessage } from '../../../shared/types';
import { createEmptyFormData } from '../../../shared/types';

export type InputMode = 'chat' | 'form';
```

替换为：

```ts
import type { FormInputData, ChatMessage, CodeAnalysisResult } from '../../../shared/types';
import { createEmptyFormData } from '../../../shared/types';

export type InputMode = 'chat' | 'form' | 'code';
export type CodeAnalysisStatus = 'idle' | 'scanning' | 'ready' | 'failed';
```

- [ ] **Step 2: 接口新增字段**

在 `interface InputState` 中，`sessionName: string | null;` 行之后新增：

```ts
  codeAnalysisStatus: CodeAnalysisStatus;
  codeAnalysisResult: CodeAnalysisResult | null;
  codeAnalysisError: string;
```

并在 `clearChat: () => void;` 行之前新增：

```ts
  setCodeAnalysisScanning: () => void;
  setCodeAnalysisResult: (result: CodeAnalysisResult) => void;
  setCodeAnalysisFailed: (message: string) => void;
  resetCodeAnalysis: () => void;
```

- [ ] **Step 3: 初始值与实现**

在 `create<InputState>` 初始值对象中，`sessionName: null,` 行之后新增：

```ts
  codeAnalysisStatus: 'idle',
  codeAnalysisResult: null,
  codeAnalysisError: '',
```

在 `setSessionInfo: ...` 行之后新增四个 action：

```ts
  setCodeAnalysisScanning: () => set({ codeAnalysisStatus: 'scanning', codeAnalysisError: '' }),
  setCodeAnalysisResult: (result) => set({ codeAnalysisStatus: 'ready', codeAnalysisResult: result, codeAnalysisError: '' }),
  setCodeAnalysisFailed: (message) => set({ codeAnalysisStatus: 'failed', codeAnalysisResult: null, codeAnalysisError: message }),
  resetCodeAnalysis: () => set({ codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '' }),
```

- [ ] **Step 4: clearChat / loadSession 一并重置代码分析态**

将 `clearChat` 的实现：

```ts
  clearChat: () => set({
    messages: [], chatText: '', status: '',
    sessionId: null, sessionName: null,
    formData: createEmptyFormData(),
  }),
```

替换为：

```ts
  clearChat: () => set({
    messages: [], chatText: '', status: '',
    sessionId: null, sessionName: null,
    formData: createEmptyFormData(),
    codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '',
  }),
```

并在 `loadSession` 的 `set({ ... })` 对象中，`isGenerating: false,` 行之后新增：

```ts
    codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '',
```

- [ ] **Step 5: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误。注意：`loadSession` 入参 `mode: InputMode` 现含 'code'，而 `session_loaded` 消息的 `inputMode: 'chat' | 'form'` 可赋值给更宽的 `InputMode`，无冲突）。

- [ ] **Step 6: Commit**

```bash
git add src/webview/panel/store/inputStore.ts
git commit -m "feat(code-analysis): inputStore 新增 code 模式 + 代码分析状态"
```

---

## Task 8: InputModeToggle — 第三段「Code」

**Files:** Modify `src/webview/panel/components/InputModeToggle.tsx`

- [ ] **Step 1: 加入 code 选项**

在 `src/webview/panel/components/InputModeToggle.tsx` 中，将：

```ts
  const options: { value: InputMode; label: string }[] = [
    { value: 'chat', label: 'Chat' },
    { value: 'form', label: 'Form' },
  ];
```

替换为：

```ts
  const options: { value: InputMode; label: string }[] = [
    { value: 'chat', label: 'Chat' },
    { value: 'form', label: 'Form' },
    { value: 'code', label: 'Code' },
  ];
```

（`InputModeToggle.css` 的 `.mode-btn { flex: 1 }` 自动适配三段，无需改样式。）

- [ ] **Step 2: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误；`'code'` 已是 `InputMode` 成员）。

- [ ] **Step 3: Commit**

```bash
git add src/webview/panel/components/InputModeToggle.tsx
git commit -m "feat(code-analysis): InputModeToggle 增加 Code 模式段"
```

---

## Task 9: CodeFolderPicker 组件 + 样式

**Files:**
- Create: `src/webview/panel/components/CodeFolderPicker.tsx`
- Create: `src/webview/panel/components/CodeFolderPicker.css`

- [ ] **Step 1: 创建 CodeFolderPicker.css**

create `src/webview/panel/components/CodeFolderPicker.css`:

```css
/* CodeFolderPicker — 代码文件夹选择入口 */
.code-picker {
  display: flex;
  flex-direction: column;
  gap: var(--eda-space-2);
  padding: var(--eda-space-2) 0;
}

.code-picker__hint {
  margin: 0;
  font-size: 12px;
  color: var(--eda-fg-secondary);
  line-height: 1.5;
}

.code-picker__btn {
  padding: var(--eda-space-2) var(--eda-space-3);
  border: 1px solid var(--eda-border);
  border-radius: var(--eda-radius-sm);
  background: var(--eda-button-bg);
  color: var(--eda-button-fg);
  cursor: pointer;
  font-size: 13px;
}

.code-picker__btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.code-picker__error {
  margin: 0;
  font-size: 12px;
  color: var(--eda-status-warning);
}
```

- [ ] **Step 2: 创建 CodeFolderPicker.tsx**

create `src/webview/panel/components/CodeFolderPicker.tsx`:

```tsx
/** 代码分析 — 文件夹选择入口（idle / scanning / failed 状态） */
import React, { useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './CodeFolderPicker.css';

export function CodeFolderPicker(): React.ReactElement {
  const status = useInputStore((s) => s.codeAnalysisStatus);
  const error = useInputStore((s) => s.codeAnalysisError);
  const setScanning = useInputStore((s) => s.setCodeAnalysisScanning);

  const handlePick = useCallback(() => {
    setScanning();
    const message: PanelToExtension = createMessage('pick_code_folder', 'panel', undefined);
    vscodeApi.postMessage(message);
  }, [setScanning]);

  return (
    <div className="code-picker">
      <p className="code-picker__hint">
        选择一个 Arduino/ESP32 固件代码文件夹，自动提取 GPIO、库与外设。
      </p>
      <button
        className="code-picker__btn"
        onClick={handlePick}
        disabled={status === 'scanning'}
      >
        {status === 'scanning' ? '扫描中…' : '选择代码文件夹'}
      </button>
      {status === 'failed' && error && <p className="code-picker__error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误）。

- [ ] **Step 4: Commit**

```bash
git add src/webview/panel/components/CodeFolderPicker.tsx src/webview/panel/components/CodeFolderPicker.css
git commit -m "feat(code-analysis): CodeFolderPicker 组件 + 样式"
```

---

## Task 10: CodeAnalysisPreview 组件 + 样式

**Files:**
- Create: `src/webview/panel/components/CodeAnalysisPreview.tsx`
- Create: `src/webview/panel/components/CodeAnalysisPreview.css`

- [ ] **Step 1: 创建 CodeAnalysisPreview.css**

create `src/webview/panel/components/CodeAnalysisPreview.css`:

```css
/* CodeAnalysisPreview — 扫描结果预览 */
.code-preview {
  display: flex;
  flex-direction: column;
  gap: var(--eda-space-2);
  padding: var(--eda-space-2) 0;
}

.code-preview__summary {
  font-size: 12px;
  color: var(--eda-fg-secondary);
}

.code-preview__section {
  display: flex;
  flex-direction: column;
  gap: var(--eda-space-1);
}

.code-preview__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--eda-fg-primary);
}

.code-preview__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--eda-space-1);
}

.code-preview__tag {
  padding: 1px 8px;
  border: 1px solid var(--eda-border);
  border-radius: var(--eda-radius-sm);
  font-size: 11px;
  color: var(--eda-fg-secondary);
}

.code-preview__list {
  margin: 0;
  padding-left: var(--eda-space-4);
  font-size: 12px;
  color: var(--eda-fg-secondary);
}

.code-preview__empty {
  font-size: 12px;
  color: var(--eda-fg-secondary);
  opacity: 0.7;
}

.code-preview__section--ambiguous .code-preview__label {
  color: var(--eda-status-warning);
}

.code-preview__notes {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: var(--eda-space-2);
  border: 1px solid var(--eda-border);
  border-radius: var(--eda-radius-sm);
  background: var(--eda-bg-primary);
  color: var(--eda-fg-primary);
  font-family: var(--eda-font-family);
  font-size: 12px;
}

.code-preview__actions {
  display: flex;
  gap: var(--eda-space-2);
}

.code-preview__btn-primary,
.code-preview__btn-secondary {
  flex: 1;
  padding: var(--eda-space-2);
  border-radius: var(--eda-radius-sm);
  cursor: pointer;
  font-size: 13px;
}

.code-preview__btn-primary {
  border: 1px solid var(--eda-border);
  background: var(--eda-button-bg);
  color: var(--eda-button-fg);
}

.code-preview__btn-secondary {
  border: 1px solid var(--eda-border);
  background: transparent;
  color: var(--eda-fg-secondary);
}
```

- [ ] **Step 2: 创建 CodeAnalysisPreview.tsx**

create `src/webview/panel/components/CodeAnalysisPreview.tsx`:

```tsx
/** 代码分析结果预览 — 用户确认后注入管线 */
import React, { useState, useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './CodeAnalysisPreview.css';

export function CodeAnalysisPreview(): React.ReactElement | null {
  const result = useInputStore((s) => s.codeAnalysisResult);
  const resetCodeAnalysis = useInputStore((s) => s.resetCodeAnalysis);
  const addMessage = useInputStore((s) => s.addMessage);
  const setIsGenerating = useInputStore((s) => s.setIsGenerating);
  const [notes, setNotes] = useState('');

  const handleConfirm = useCallback(() => {
    if (!result) return;
    addMessage('user', `[代码分析] 已导入固件代码，扫描 ${result.scannedFiles} 个文件`);
    setIsGenerating(true);
    const message: PanelToExtension = createMessage(
      'submit_code_analysis', 'panel', { result, notes },
    );
    vscodeApi.postMessage(message);
    resetCodeAnalysis();
  }, [result, notes, addMessage, setIsGenerating, resetCodeAnalysis]);

  if (!result) return null;

  return (
    <div className="code-preview">
      <div className="code-preview__summary">
        扫描了 {result.scannedFiles} 个文件
        {result.truncated ? '（已达上限，仅扫描部分文件）' : ''}
      </div>

      <div className="code-preview__section">
        <span className="code-preview__label">检测到的库 ({result.detectedLibraries.length})</span>
        {result.detectedLibraries.length > 0 ? (
          <div className="code-preview__tags">
            {result.detectedLibraries.map((l) => (
              <span key={l} className="code-preview__tag">{l}</span>
            ))}
          </div>
        ) : <span className="code-preview__empty">无</span>}
      </div>

      <div className="code-preview__section">
        <span className="code-preview__label">检测到的外设 ({result.detectedPeripherals.length})</span>
        {result.detectedPeripherals.length > 0 ? (
          <div className="code-preview__tags">
            {result.detectedPeripherals.map((p) => (
              <span key={p} className="code-preview__tag">{p}</span>
            ))}
          </div>
        ) : <span className="code-preview__empty">无</span>}
      </div>

      <div className="code-preview__section">
        <span className="code-preview__label">GPIO 使用 ({result.detectedGpios.length})</span>
        {result.detectedGpios.length > 0 ? (
          <ul className="code-preview__list">
            {result.detectedGpios.map((g) => (
              <li key={g.pin}>引脚 {g.pin} · {g.direction} · {g.usage}</li>
            ))}
          </ul>
        ) : <span className="code-preview__empty">无</span>}
      </div>

      {result.ambiguousReferences.length > 0 && (
        <div className="code-preview__section code-preview__section--ambiguous">
          <span className="code-preview__label">
            模糊引用 ({result.ambiguousReferences.length})
          </span>
          <ul className="code-preview__list">
            {result.ambiguousReferences.map((a) => (
              <li key={a.reference}>{a.reference}: {a.question}</li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        className="code-preview__notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="补充说明（可选）：项目用途、代码未体现的需求…"
        rows={2}
      />

      <div className="code-preview__actions">
        <button className="code-preview__btn-secondary" onClick={resetCodeAnalysis}>
          重选文件夹
        </button>
        <button className="code-preview__btn-primary" onClick={handleConfirm}>
          用此分析生成报告
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误。注意 hooks 全部在 `if (!result) return null` 之前调用，符合 Rules of Hooks）。

- [ ] **Step 4: Commit**

```bash
git add src/webview/panel/components/CodeAnalysisPreview.tsx src/webview/panel/components/CodeAnalysisPreview.css
git commit -m "feat(code-analysis): CodeAnalysisPreview 组件 + 样式"
```

---

## Task 11: PanelApp — code 模式渲染 + 消息处理

**Files:** Modify `src/webview/panel/PanelApp.tsx`

- [ ] **Step 1: import 新组件**

在 import 区，`import { TemplateSelector } from './components/TemplateSelector';` 行之后新增：

```ts
import { CodeFolderPicker } from './components/CodeFolderPicker';
import { CodeAnalysisPreview } from './components/CodeAnalysisPreview';
```

- [ ] **Step 2: 从 store 取代码分析状态 + setter**

在组件内 `const setSessionInfo = useInputStore((s) => s.setSessionInfo);` 行之后新增：

```ts
  const codeAnalysisStatus = useInputStore((s) => s.codeAnalysisStatus);
  const setCodeAnalysisResult = useInputStore((s) => s.setCodeAnalysisResult);
  const setCodeAnalysisFailed = useInputStore((s) => s.setCodeAnalysisFailed);
```

- [ ] **Step 3: 处理 2 条新消息**

在 `handler` 的 `switch (msg.type)` 中，`case 'session_saved':` 块之后、`switch` 闭合 `}` 之前新增：

```ts
        case 'code_analysis_result':
          setCodeAnalysisResult(msg.payload.result);
          break;
        case 'code_analysis_failed':
          setCodeAnalysisFailed(msg.payload.message);
          break;
```

并将 `useEffect` 依赖数组：

```ts
  }, [addMessage, appendToLastMessage, setStatus, setIsGenerating, loadSession, clearChat, setSessionInfo]);
```

替换为：

```ts
  }, [addMessage, appendToLastMessage, setStatus, setIsGenerating, loadSession, clearChat, setSessionInfo, setCodeAnalysisResult, setCodeAnalysisFailed]);
```

- [ ] **Step 4: 输入区按三模式渲染**

将：

```tsx
      {/* 输入区域 */}
      <div className="input-area">
        <InputModeToggle />
        {mode === 'chat' ? <ChatInput /> : <FormInput />}
      </div>
```

替换为：

```tsx
      {/* 输入区域 */}
      <div className="input-area">
        <InputModeToggle />
        {mode === 'chat' && <ChatInput />}
        {mode === 'form' && <FormInput />}
        {mode === 'code' && (
          codeAnalysisStatus === 'ready'
            ? <CodeAnalysisPreview />
            : <CodeFolderPicker />
        )}
      </div>
```

- [ ] **Step 5: 编译（tsc + esbuild 三入口）**

Run: `npm run compile`
Expected: PASS（`tsc --noEmit` 零错误 + esbuild 构建 extension/panel/report 三入口成功）。

- [ ] **Step 6: Commit**

```bash
git add src/webview/panel/PanelApp.tsx
git commit -m "feat(code-analysis): PanelApp 集成 code 模式渲染 + 消息处理"
```

---

## Task 12: 终检 + 文档同步 + 打包

**Files:**
- Modify: `progress.txt`
- Modify: `docs/IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: 全量门禁**

Run: `npm run compile && npm test`
Expected: `tsc` 零错误；esbuild 三入口成功；测试全绿（136 原有 + arduinoAnalyzer 17 + InputService 5 = 158）。

- [ ] **Step 2: 无 console.log 残留检查**

Run: `grep -rn "console.log" src/extension/analyzers src/extension/services/CodeAnalysisService.ts src/webview/panel/components/CodeFolderPicker.tsx src/webview/panel/components/CodeAnalysisPreview.tsx`
Expected: 空输出。

- [ ] **Step 3: 打包验证**

Run: `npx @vscode/vsce package`
Expected: 成功生成 `.vsix`（9 files），无报错。记录文件数与体积。

- [ ] **Step 4: 更新 progress.txt**

读 `progress.txt` 末尾。当前结尾是一个 `### 下一步` 小节。将该 `### 下一步` 整节（含标题到文件末尾）替换为：

```
## 2026-05-21

### 代码分析输入 ✅

**范围**：选 Arduino/ESP32 固件代码文件夹 → 本地启发式扫描器提取 GPIO/库/外设 → 侧边栏预览 → 确认后注入现有需求管线。V1 仅 Arduino C/C++，零 AI token 提取。

**新增**：
- arduinoAnalyzer.ts 纯逻辑（stripComments / buildSymbolTable / extractLibraries / extractGpios / extractPeripherals / analyzeArduinoCode）+ arduinoAnalyzer.test.ts（约 18 测试）
- CodeAnalysisService.ts 文件遍历编排（上限 200 文件 / 2MB，跳过 .git/node_modules/build 等）
- CodeAnalysisResult 扩展 scannedFiles/truncated
- InputService.fromCodeAnalysis + _codeContextToText 序列化 + InputService.test.ts（5 测试）
- requirementPrompt SYSTEM_PROMPT 新增代码上下文规则（规则 8）
- 消息协议：pick_code_folder / submit_code_analysis / code_analysis_result / code_analysis_failed
- 侧边栏「Code」模式：InputModeToggle 第三段 + CodeFolderPicker + CodeAnalysisPreview + inputStore 代码分析状态

**设计决策**：扫描引擎用本地正则/模式（零 token、确定性、纯函数易测），非 AI 提取；「Code」为面板本地 UI 模式，不经协议传递；模糊引用经预览展示 + 注入后成为报告 openQuestions。

**§13.5 步骤 7 自检清单**：
- [x] `npm run compile`（tsc 零错误 + esbuild 三入口）
- [x] `npm test`（全套测试全绿）
- [x] `npx @vscode/vsce package` 成功
- [x] 无 console.log 残留
- [x] progress.txt / IMPLEMENTATION_PLAN.md 已更新
- [x] worktree 分支开发

### 下一步
- Python / MicroPython 代码分析（本轮明确推迟）
- 多方案并排对比视图（后续单独立项）
- SessionStorageService / SessionManager 单元测试补充
```

（若 Step 3 的 vsce 打包失败，将 `- [x] npx @vscode/vsce package 成功` 改为 `- [ ]` 并在变更说明中标注。）

- [ ] **Step 5: 更新 IMPLEMENTATION_PLAN.md §10.4 验收勾选**

在 `docs/IMPLEMENTATION_PLAN.md` §10.4 验收标准中，将 5 条替换为：

```
- [x] 选择包含 ESP32 Arduino 代码的文件夹 → 检测出 GPIO / 库 / 外设
- [x] 检测到模糊引用时向用户提问确认（经预览展示 + 注入后成为 openQuestions）
- [x] 代码分析结果可预览，用户确认后注入管线
- [x] 纯代码输入也能生成完整 RequirementSpec
- [ ] 支持 C、C++、Python 三种语言（V1 仅 C/C++ Arduino；Python 后续单独立项）
```

- [ ] **Step 6: Commit**

```bash
git add progress.txt docs/IMPLEMENTATION_PLAN.md
git commit -m "docs: 代码分析输入 progress 记录 + §10.4 验收勾选"
```

- [ ] **Step 7: 收尾**

调用 `superpowers:finishing-a-development-branch` 决定合并/PR/清理（合并到 main 由用户确认，项目惯例 `--no-ff`）。

---

## Self-Review（计划编写者已执行）

**1. Spec 覆盖**：§3 数据流→Task 6+11；§4 数据模型→Task 1；§5 扫描器→Task 2；§6 CodeAnalysisService→Task 5；§7 InputService+prompt→Task 4；§8 消息协议→Task 3；§9 前端→Task 7/8/9/10/11；§12 测试→Task 2/4；§13 错误处理→Task 5（NoArduinoFilesError）+ Task 6（cancel/失败→code_analysis_failed）；§14 验收→Task 12。无遗漏。Python/交互式问答/深度分析已在 spec 排除。

**2. 占位符扫描**：无 TBD/TODO；每个改代码步骤含完整代码与确切锚点；命令均给预期输出。

**3. 类型/签名一致性**：`SourceFile`/`ArduinoAnalysis`（Task 2）→ CodeAnalysisService 引用（Task 5）一致；`analyzeArduinoCode`/`stripComments`/`buildSymbolTable`/`extractLibraries`/`extractGpios`/`extractPeripherals`（Task 2 定义）→ 测试与 Service 调用名一致；`CodeAnalysisResult.scannedFiles/truncated`（Task 1）→ CodeAnalysisService 补字段（Task 5）+ 预览显示（Task 10）一致；`fromCodeAnalysis`（Task 4）→ activate 调用（Task 6）一致；消息 `pick_code_folder`/`submit_code_analysis`/`code_analysis_result`/`code_analysis_failed`（Task 3）→ 发送端（Task 9/10）、接收端（Task 6/11）端到端一致；`InputMode` 含 'code'（Task 7）→ InputModeToggle（Task 8）+ PanelApp（Task 11）一致；inputStore 的 `setCodeAnalysisScanning/Result/Failed`、`resetCodeAnalysis`、`codeAnalysisStatus/Result/Error`（Task 7）→ 组件消费（Task 9/10/11）一致。

**每提交可编译**：每个 Task 末尾 `npm run check-types` 均应 PASS，无不可编译的中间状态（Task 8 之后、Task 11 之前选「Code」会短暂回退渲染 ChatInput/FormInput，非编译错误，Task 11 修复）。
