# Python/MicroPython 代码分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 8 V1 已落地的代码分析流程从 Arduino C/C++ 扩到 **MicroPython + CircuitPython**;遇到混合工程(`.ino` + `.py` 共存)时让用户在 Webview 选主语言再分析。

**Architecture:** 新增 `pythonAnalyzer.ts` 纯函数(对称 `arduinoAnalyzer.ts`),含**变量绑定表**(`led = Pin(13); led.value(1)` → 反推 GPIO 13 output);`CodeAnalysisService` 改造为按扩展名分桶 + 单语言走对应分析器、混合时抛 `MixedCodeError`;Webview 加 `CodeLanguagePicker` 组件 + `select_code_language` 消息回流二次分析。复用全部既有 `CodeAnalysisResult`/`fromCodeAnalysis`/`CodeAnalysisPreview` 设施。

**Tech Stack:** TypeScript, VS Code Extension API, React 18, Zustand, Vitest, esbuild。

**Spec:** `docs/superpowers/specs/2026-05-24-python-code-analysis-design.md`

---

## 前置:工作区隔离

执行前用 `superpowers:using-git-worktrees` 创建隔离工作区(CLAUDE.md §15.1):

- 分支语义:`feat/phase8v2/python-code-analysis`(原生 EnterWorktree 按自身规则命名)
- 基点:**`main` 当前 HEAD**(`1dc8fd9`,含本设计与计划文档)
- `.claude/settings.json` 已配 `worktree.baseRef: head`,但若该文件丢失或基点漂移,建完后立即 `git log` 核对,必要时 `git reset --hard main`(见项目 worktree 基点备忘)。

所有任务在该 worktree 内执行。`node -v` 应为 v20.x。Baseline:`npm test` 应 **160 测试全绿**(Phase 8 V1 完成态)。

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/extension/analyzers/pythonAnalyzer.ts` | 纯函数:Python 代码提取库/GPIO/外设/模糊引用 + 绑定变量表 |
| 新建 | `src/extension/analyzers/pythonAnalyzer.test.ts` | pythonAnalyzer 单元测试 |
| 新建 | `src/extension/services/CodeAnalysisService.test.ts` | 服务编排测试(若已存在则补充) |
| 新建 | `src/webview/panel/components/CodeLanguagePicker.tsx` + `.css` | 混合工程语言选择器 |
| 修改 | `src/shared/types/messages.types.ts` | 加 `select_code_language` / `code_analysis_mixed` |
| 修改 | `src/extension/services/CodeAnalysisService.ts` | 双桶 walk + 路由 + `MixedCodeError` + `NoCodeFilesError` + `analyzeWithLanguage` |
| 修改 | `src/extension/services/InputService.ts` | `langLabel.python` 文案改 `MicroPython/CircuitPython` |
| 修改 | `src/extension/services/InputService.test.ts` | 加 Python 文案断言 |
| 修改 | `src/extension/activate.ts` | `pick_code_folder` 分支 MixedCodeError + 新 `select_code_language` handler |
| 修改 | `src/webview/panel/store/inputStore.ts` | `CodeAnalysisStatus` 加 `'mixed'`,新增 folderUri/mixedInfo |
| 修改 | `src/webview/panel/PanelApp.tsx` | switch case 'mixed' + 新消息 handler |
| 修改 | `progress.txt` | Phase 8 V2 完成条目 |
| 修改 | `docs/IMPLEMENTATION_PLAN.md` | §10.4 Python 项打勾 |

---

## Task PY1: 消息协议扩展

**Files:**
- Modify: `src/shared/types/messages.types.ts`

- [ ] **Step 1: 在 `PanelToExtension` 联合末尾加 `select_code_language`**

将文件第 28-43 行的 `PanelToExtension` 联合体最后一行 `| BaseMessage<'submit_code_analysis', { result: CodeAnalysisResult; notes: string }>;` 改为:

```ts
  | BaseMessage<'submit_code_analysis', { result: CodeAnalysisResult; notes: string }>
  | BaseMessage<'select_code_language', { folderUri: string; language: 'cpp' | 'python' }>;
```

- [ ] **Step 2: 在 `ExtensionToPanel` 联合末尾加 `code_analysis_mixed`**

将第 47-57 行 `ExtensionToPanel` 末行 `| BaseMessage<'code_analysis_failed', { message: string }>;` 改为:

```ts
  | BaseMessage<'code_analysis_failed', { message: string }>
  | BaseMessage<'code_analysis_mixed', { folderUri: string; cppCount: number; pyCount: number }>;
```

- [ ] **Step 3: 类型自检**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 通过(消息类型新增不会破坏既有 consumer,因为所有 switch 默认 break;Webview 暂无新 handler 是允许的)。

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/messages.types.ts
git commit -m "feat(messages): 加 select_code_language / code_analysis_mixed"
```

---

## Task PY2: pythonAnalyzer 纯逻辑模块 + 单测(TDD)

**Files:**
- Create: `src/extension/analyzers/pythonAnalyzer.ts`
- Create: `src/extension/analyzers/pythonAnalyzer.test.ts`

> **TDD 节奏:** 每节先写测、跑红、最小实现转绿、再加测。底部一次 commit。

- [ ] **Step 1: 建文件骨架 + 第一个测(stripComments)**

`src/extension/analyzers/pythonAnalyzer.ts`:

```ts
/**
 * MicroPython / CircuitPython 启发式扫描器 — 纯函数,无 vscode 依赖。
 * 提取库引用 / GPIO 使用 / 外设 / 模糊引用,供 CodeAnalysisService 编排调用。
 */
import type { GpioUsage, AmbiguousRef, CodeAnalysisResult } from '@shared/types';

/** 待分析的源文件 */
export interface SourceFile {
  path: string;
  content: string;
}

/** analyzePythonCode 的返回(scannedFiles/truncated 由编排层补) */
export type PythonAnalysis = Omit<CodeAnalysisResult, 'scannedFiles' | 'truncated'>;

/**
 * 去掉行注释 (#...\n) 与三引号块字符串 ('''...''' / """...""")。
 * 注意:不处理引号内的 #,但对 import / 调用提取无实际影响。
 */
export function stripComments(code: string): string {
  return code
    .replace(/'''[\s\S]*?'''/g, ' ')
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/#[^\n]*/g, ' ');
}
```

`src/extension/analyzers/pythonAnalyzer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  stripComments,
} from './pythonAnalyzer';

describe('stripComments', () => {
  it('strips line comments', () => {
    const out = stripComments('x = 1  # this is a comment\ny = 2');
    expect(out).not.toContain('this is a comment');
    expect(out).toContain('x = 1');
    expect(out).toContain('y = 2');
  });

  it('strips triple-single-quoted blocks', () => {
    const out = stripComments("a = 1\n'''docstring with code Pin(99, Pin.OUT)'''\nb = 2");
    expect(out).not.toContain('Pin(99');
  });

  it('strips triple-double-quoted blocks', () => {
    const out = stripComments('a = 1\n"""docstring Pin(88, Pin.OUT)"""\nb = 2');
    expect(out).not.toContain('Pin(88');
  });
});
```

- [ ] **Step 2: 跑测**

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 3 测全过。

- [ ] **Step 3: 加 `buildSymbolTable` + 测**

在 `pythonAnalyzer.ts` 末尾加:

```ts
/** token 是否引脚字面量(纯数字或形如 D13 的标识) */
function isIntLiteral(token: string): boolean {
  return /^\d+$/.test(token) || /^0x[0-9a-fA-F]+$/.test(token);
}

/**
 * 收集 `NAME = <int>` 与 `NAME = const(<int>)`,构建 标识符→整型字面量 映射。
 * 表达式赋值跳过;重名只取首次。
 */
export function buildSymbolTable(code: string): Map<string, string> {
  const table = new Map<string, string>();
  const patterns = [
    /^[ \t]*([A-Za-z_]\w*)\s*=\s*(?:const\(\s*)?(0x[0-9a-fA-F]+|\d+)(?:\s*\))?\s*$/gm,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      if (!table.has(m[1])) table.set(m[1], m[2]);
    }
  }
  return table;
}
```

测试文件追加:

```ts
import { buildSymbolTable } from './pythonAnalyzer';

describe('buildSymbolTable', () => {
  it('captures direct int assignment', () => {
    const t = buildSymbolTable('LED_PIN = 13\nBUTTON = 2');
    expect(t.get('LED_PIN')).toBe('13');
    expect(t.get('BUTTON')).toBe('2');
  });

  it('captures const() wrapped int', () => {
    const t = buildSymbolTable('LED = const(5)\nBTN = const(0x10)');
    expect(t.get('LED')).toBe('5');
    expect(t.get('BTN')).toBe('0x10');
  });

  it('skips expression assignments', () => {
    const t = buildSymbolTable('LED = BASE + 1\nVALID = 7');
    expect(t.has('LED')).toBe(false);
    expect(t.get('VALID')).toBe('7');
  });

  it('keeps first assignment on duplicate name', () => {
    const t = buildSymbolTable('LED = 13\nLED = 14');
    expect(t.get('LED')).toBe('13');
  });
});
```

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 7 测全过。

- [ ] **Step 4: 加 `buildBindingTable` + 测**

在 `pythonAnalyzer.ts` 末尾加:

```ts
/** 引脚 token 解析:数字字面量 / board.XXX 去前缀 / 符号表命中 / 不命中返回 null */
function resolvePinToken(
  token: string,
  symbols: Map<string, string>,
): { pin: string; resolved: boolean } {
  const t = token.trim();
  if (isIntLiteral(t)) return { pin: t, resolved: true };
  const boardMatch = t.match(/^board\.([A-Za-z_]\w*)$/);
  if (boardMatch) return { pin: boardMatch[1], resolved: true };
  if (symbols.has(t)) return { pin: symbols.get(t)!, resolved: true };
  return { pin: t, resolved: false };
}

/** 绑定表条目 */
export interface PinBinding {
  pin: string;
  direction?: 'input' | 'output';
  resolved: boolean;
}

/**
 * 抓产生引脚句柄的句式(构造调用),并扫描 `.direction = ...` 升级方向。
 * 后赋值的 binding 覆盖前者(单文件合并扫描的接受限制)。
 */
export function buildBindingTable(
  code: string,
  symbols: Map<string, string>,
): Map<string, PinBinding> {
  const bindings = new Map<string, PinBinding>();

  // MicroPython: NAME = Pin(<pin>, Pin.OUT|Pin.IN[, ...])
  for (const m of code.matchAll(
    /\b([A-Za-z_]\w*)\s*=\s*(?:machine\.)?Pin\(\s*([^,)\s]+)\s*(?:,\s*Pin\.(OUT|IN))?[^)]*\)/g,
  )) {
    const [, name, pinTok, dir] = m;
    const r = resolvePinToken(pinTok, symbols);
    const direction: PinBinding['direction'] | undefined =
      dir === 'OUT' ? 'output' : dir === 'IN' ? 'input' : undefined;
    bindings.set(name, { pin: r.pin, direction, resolved: r.resolved });
  }

  // CircuitPython: NAME = digitalio.DigitalInOut(<pin>)
  for (const m of code.matchAll(
    /\b([A-Za-z_]\w*)\s*=\s*digitalio\.DigitalInOut\(\s*([^)\s]+)\s*\)/g,
  )) {
    const [, name, pinTok] = m;
    const r = resolvePinToken(pinTok, symbols);
    bindings.set(name, { pin: r.pin, resolved: r.resolved });
  }

  // CircuitPython: NAME = analogio.AnalogIn(<pin>) / AnalogOut
  for (const m of code.matchAll(
    /\b([A-Za-z_]\w*)\s*=\s*analogio\.Analog(In|Out)\(\s*([^)\s]+)\s*\)/g,
  )) {
    const [, name, kind, pinTok] = m;
    const r = resolvePinToken(pinTok, symbols);
    bindings.set(name, {
      pin: r.pin,
      direction: kind === 'In' ? 'input' : 'output',
      resolved: r.resolved,
    });
  }

  // CircuitPython: NAME = pwmio.PWMOut(<pin>, ...)
  for (const m of code.matchAll(
    /\b([A-Za-z_]\w*)\s*=\s*pwmio\.PWMOut\(\s*([^,)\s]+)/g,
  )) {
    const [, name, pinTok] = m;
    const r = resolvePinToken(pinTok, symbols);
    bindings.set(name, { pin: r.pin, direction: 'output', resolved: r.resolved });
  }

  // 后续 NAME.direction = digitalio.Direction.OUTPUT|INPUT — 升级或冲突
  for (const m of code.matchAll(
    /\b([A-Za-z_]\w*)\.direction\s*=\s*digitalio\.Direction\.(OUTPUT|INPUT)/g,
  )) {
    const [, name, dir] = m;
    const entry = bindings.get(name);
    if (!entry) continue;
    const newDir: 'input' | 'output' = dir === 'OUTPUT' ? 'output' : 'input';
    entry.direction = entry.direction && entry.direction !== newDir ? undefined : newDir;
  }

  return bindings;
}
```

测试文件追加:

```ts
import { buildBindingTable } from './pythonAnalyzer';

describe('buildBindingTable', () => {
  it('MicroPython Pin(13, Pin.OUT) — direction=output', () => {
    const b = buildBindingTable('led = Pin(13, Pin.OUT)', new Map());
    const e = b.get('led')!;
    expect(e.pin).toBe('13');
    expect(e.direction).toBe('output');
  });

  it('MicroPython Pin(13) — direction undefined', () => {
    const b = buildBindingTable('led = Pin(13)', new Map());
    expect(b.get('led')!.direction).toBeUndefined();
  });

  it('CircuitPython digitalio.DigitalInOut(board.D13) — strip board.', () => {
    const b = buildBindingTable('led = digitalio.DigitalInOut(board.D13)', new Map());
    expect(b.get('led')!.pin).toBe('D13');
    expect(b.get('led')!.direction).toBeUndefined();
  });

  it('CircuitPython .direction = OUTPUT upgrades direction', () => {
    const code = `led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT`;
    const b = buildBindingTable(code, new Map());
    expect(b.get('led')!.direction).toBe('output');
  });

  it('analogio.AnalogIn — direction=input', () => {
    const b = buildBindingTable('mic = analogio.AnalogIn(board.A0)', new Map());
    expect(b.get('mic')).toEqual({ pin: 'A0', direction: 'input', resolved: true });
  });

  it('pwmio.PWMOut — direction=output', () => {
    const b = buildBindingTable('buzz = pwmio.PWMOut(board.D5, frequency=440)', new Map());
    expect(b.get('buzz')!.direction).toBe('output');
    expect(b.get('buzz')!.pin).toBe('D5');
  });

  it('Pin(LED_PIN) — 经符号表解析', () => {
    const syms = new Map([['LED_PIN', '13']]);
    const b = buildBindingTable('led = Pin(LED_PIN)', syms);
    expect(b.get('led')!.pin).toBe('13');
    expect(b.get('led')!.resolved).toBe(true);
  });

  it('未解析 pin token — resolved=false', () => {
    const b = buildBindingTable('led = Pin(SOMETHING)', new Map());
    expect(b.get('led')!.resolved).toBe(false);
    expect(b.get('led')!.pin).toBe('SOMETHING');
  });
});
```

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 15 测全过。

- [ ] **Step 5: 加 `extractGpios` + 测**

在 `pythonAnalyzer.ts` 末尾加:

```ts
/**
 * 提取 GPIO 使用,合并三个来源:绑定表本身 / 绑定变量的方法调用 / 直接 API 调用。
 */
export function extractGpios(
  code: string,
  symbols: Map<string, string>,
  bindings: Map<string, PinBinding>,
): { gpios: GpioUsage[]; ambiguous: AmbiguousRef[] } {
  // pin → { directions, usages }
  const acc = new Map<string, { directions: Set<'input' | 'output'>; usages: Set<string> }>();
  const unresolved = new Set<string>();

  const record = (pin: string, direction: 'input' | 'output' | undefined, usage: string): void => {
    let entry = acc.get(pin);
    if (!entry) {
      entry = { directions: new Set(), usages: new Set() };
      acc.set(pin, entry);
    }
    if (direction) entry.directions.add(direction);
    entry.usages.add(usage);
  };

  // 来源 1:绑定表条目入账
  for (const [name, b] of bindings) {
    record(b.pin, b.direction, `${name} · 构造`);
    if (!b.resolved) unresolved.add(b.pin);
  }

  // 来源 2:绑定变量后续调用反推方向
  // OUTPUT: NAME.value(<expr>) / .on() / .off() / .high() / .low() / .value = <expr>
  for (const m of code.matchAll(
    /\b([A-Za-z_]\w*)\.(?:value\(\s*[^)]+\s*\)|on\(\s*\)|off\(\s*\)|high\(\s*\)|low\(\s*\)|value\s*=)/g,
  )) {
    const b = bindings.get(m[1]);
    if (b) record(b.pin, 'output', `${m[1]} · 调用`);
  }
  // INPUT: NAME.value() 无参 / NAME.irq(...)
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\.value\(\s*\)/g)) {
    const b = bindings.get(m[1]);
    if (b) record(b.pin, 'input', `${m[1]} · 读`);
  }
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\.irq\(/g)) {
    const b = bindings.get(m[1]);
    if (b) record(b.pin, 'input', `${m[1]} · irq`);
  }

  // 来源 3:直接出现的 API 调用(无绑定也抓)
  for (const m of code.matchAll(
    /(?:machine\.)?Pin\(\s*([^,)\s]+)\s*,\s*Pin\.(OUT|IN)/g,
  )) {
    const [, pinTok, dir] = m;
    const r = resolvePinToken(pinTok, symbols);
    if (!r.resolved) unresolved.add(r.pin);
    record(r.pin, dir === 'OUT' ? 'output' : 'input', `Pin.${dir}`);
  }

  const gpios: GpioUsage[] = [...acc.entries()]
    .map(([pin, e]) => {
      let direction: GpioUsage['direction'];
      if (e.directions.size === 0) direction = 'unknown';
      else if (e.directions.size > 1) direction = 'unknown';
      else if (e.directions.has('output')) direction = 'output';
      else direction = 'input';
      return { pin, direction, usage: [...e.usages].join('; ') };
    })
    .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));

  const ambiguous: AmbiguousRef[] = [...unresolved].sort().map((ref) => ({
    reference: ref,
    possibleMeanings: ['Python 标识符未在 NAME = <int> / const() 中找到'],
    question: `代码中 \`${ref}\` 对应的实际 GPIO 引脚号是多少?`,
  }));

  return { gpios, ambiguous };
}
```

测试文件追加:

```ts
import { extractGpios } from './pythonAnalyzer';

describe('extractGpios', () => {
  it('绑定 + .value(1) → output', () => {
    const code = 'led = Pin(13)\nled.value(1)';
    const syms = new Map();
    const bindings = buildBindingTable(code, syms);
    const { gpios } = extractGpios(code, syms, bindings);
    expect(gpios.find(g => g.pin === '13')!.direction).toBe('output');
  });

  it('绑定 + .value() 无参 → input', () => {
    const code = 'btn = Pin(2)\nv = btn.value()';
    const b = buildBindingTable(code, new Map());
    const { gpios } = extractGpios(code, new Map(), b);
    expect(gpios.find(g => g.pin === '2')!.direction).toBe('input');
  });

  it('绑定 + .on()/.off() → output', () => {
    const code = 'led = Pin(13)\nled.on()\nled.off()';
    const b = buildBindingTable(code, new Map());
    const { gpios } = extractGpios(code, new Map(), b);
    expect(gpios.find(g => g.pin === '13')!.direction).toBe('output');
  });

  it('绑定 + .irq → input', () => {
    const code = 'btn = Pin(2)\nbtn.irq(handler=cb)';
    const b = buildBindingTable(code, new Map());
    const { gpios } = extractGpios(code, new Map(), b);
    expect(gpios.find(g => g.pin === '2')!.direction).toBe('input');
  });

  it('同 pin 多方向 → unknown', () => {
    const code = 'p = Pin(5, Pin.OUT)\np.value()';
    const b = buildBindingTable(code, new Map());
    const { gpios } = extractGpios(code, new Map(), b);
    expect(gpios.find(g => g.pin === '5')!.direction).toBe('unknown');
  });

  it('未解析 pin token → ambiguousReferences', () => {
    const code = 'led = Pin(MYSTERY_PIN)';
    const b = buildBindingTable(code, new Map());
    const { ambiguous } = extractGpios(code, new Map(), b);
    expect(ambiguous.find(a => a.reference === 'MYSTERY_PIN')).toBeDefined();
  });

  it('直接 Pin(13, Pin.OUT) 无绑定也抓', () => {
    const code = 'Pin(13, Pin.OUT).value(1)';
    const { gpios } = extractGpios(code, new Map(), new Map());
    expect(gpios.find(g => g.pin === '13')!.direction).toBe('output');
  });
});
```

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 22 测全过。

- [ ] **Step 6: 加 `extractLibraries` + 测**

在 `pythonAnalyzer.ts` 末尾加:

```ts
/**
 * MicroPython + CircuitPython 运行时内建模块,不计入"用户引入的库"。
 * 注:`neopixel` 故意不在此集 — 语义重要,展示给用户。
 */
const STDLIB_MODULES = new Set([
  // MicroPython
  'machine', 'micropython', 'time', 'gc', 'os', 'sys', 'struct', 'binascii',
  'network', 'socket', 'ssl', 'ubinascii', 'ujson', 'urequests', 'uasyncio',
  'asyncio', 'framebuf', 'math', 'random', '_thread', 'select',
  // CircuitPython
  'board', 'digitalio', 'analogio', 'busio', 'pwmio', 'pulseio',
  'microcontroller', 'supervisor', 'storage', 'usb_hid', 'displayio',
  'terminalio', 'audioio', 'audiocore', 'audiomixer', 'audiopwmio',
  'audiobusio', 'rotaryio', 'countio', 'keypad', 'touchio',
]);

/** 提取顶级 import / from-import 模块名(去重、排序、过滤 stdlib) */
export function extractLibraries(code: string): string[] {
  const libs = new Set<string>();
  // import foo / import foo.bar / import foo as f
  for (const m of code.matchAll(/^\s*import\s+([A-Za-z_]\w*)(?:\.[\w.]*)?(?:\s+as\s+\w+)?\s*$/gm)) {
    libs.add(m[1]);
  }
  // from foo import x / from foo.bar import x
  for (const m of code.matchAll(/^\s*from\s+([A-Za-z_]\w*)(?:\.[\w.]*)?\s+import\s+/gm)) {
    libs.add(m[1]);
  }
  return [...libs].filter((m) => !STDLIB_MODULES.has(m)).sort();
}
```

测试文件追加:

```ts
import { extractLibraries } from './pythonAnalyzer';

describe('extractLibraries', () => {
  it('captures import and from-import top-level', () => {
    const out = extractLibraries('import dht\nfrom ssd1306 import SSD1306_I2C');
    expect(out).toEqual(['dht', 'ssd1306']);
  });

  it('reduces dotted import to top module', () => {
    const out = extractLibraries('import adafruit_bus_device.spi_device\nfrom foo.bar import x');
    expect(out).toEqual(['adafruit_bus_device', 'foo']);
  });

  it('filters MicroPython stdlib', () => {
    const out = extractLibraries('import machine\nimport time\nimport dht');
    expect(out).toEqual(['dht']);
  });

  it('filters CircuitPython stdlib', () => {
    const out = extractLibraries('import board\nimport digitalio\nimport adafruit_dht');
    expect(out).toEqual(['adafruit_dht']);
  });

  it('keeps neopixel as user library', () => {
    const out = extractLibraries('import neopixel\nimport machine');
    expect(out).toEqual(['neopixel']);
  });
});
```

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 27 测全过。

- [ ] **Step 7: 加 `extractPeripherals` + 测**

在 `pythonAnalyzer.ts` 末尾加:

```ts
/** 由 API 调用 / import 推断外设规范名 */
export function extractPeripherals(code: string): string[] {
  const found = new Set<string>();
  const rules: { name: string; test: RegExp }[] = [
    { name: 'I2C', test: /\bmachine\.I2C|busio\.I2C|from\s+machine\s+import\s+(?:[\w,\s]*\b)?I2C\b/ },
    { name: 'SPI', test: /\bmachine\.SPI|busio\.SPI|from\s+machine\s+import\s+(?:[\w,\s]*\b)?SPI\b/ },
    { name: 'UART', test: /\bmachine\.UART|busio\.UART|from\s+machine\s+import\s+(?:[\w,\s]*\b)?UART\b/ },
    { name: 'PWM', test: /\bmachine\.PWM|pwmio\.PWMOut/ },
    { name: 'ADC', test: /\bmachine\.ADC|analogio\.AnalogIn/ },
    { name: 'DAC', test: /\banalogio\.AnalogOut/ },
    { name: 'WiFi', test: /\bimport\s+network\b|\bnetwork\.WLAN/ },
    { name: 'BLE/蓝牙', test: /\bimport\s+bluetooth\b|\bimport\s+aioble\b|\bbluetooth\.BLE/ },
    { name: 'NeoPixel', test: /\bimport\s+neopixel\b|\bNeoPixel\(/ },
    { name: '显示', test: /\bframebuf\.FrameBuffer|displayio\.Display|\bssd1306\b|\badafruit_ssd1306\b/ },
  ];
  for (const { name, test } of rules) {
    if (test.test(code)) found.add(name);
  }
  return [...found].sort();
}
```

测试文件追加:

```ts
import { extractPeripherals } from './pythonAnalyzer';

describe('extractPeripherals', () => {
  it('detects I2C via machine.I2C', () => {
    expect(extractPeripherals('i = machine.I2C(0)')).toContain('I2C');
  });

  it('detects I2C via busio.I2C', () => {
    expect(extractPeripherals('i = busio.I2C(board.SCL, board.SDA)')).toContain('I2C');
  });

  it('detects I2C via `from machine import I2C`', () => {
    expect(extractPeripherals('from machine import I2C\ni = I2C(0)')).toContain('I2C');
  });

  it('detects PWM via pwmio.PWMOut', () => {
    expect(extractPeripherals('p = pwmio.PWMOut(board.D5)')).toContain('PWM');
  });

  it('detects WiFi via import network', () => {
    expect(extractPeripherals('import network\nwlan = network.WLAN()')).toContain('WiFi');
  });

  it('de-dupes — only one entry per peripheral', () => {
    const code = 'import machine\ni = machine.I2C(0)\ni2 = busio.I2C(board.SCL, board.SDA)';
    const out = extractPeripherals(code);
    expect(out.filter(p => p === 'I2C')).toHaveLength(1);
  });
});
```

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 33 测全过。

- [ ] **Step 8: 加 `analyzePythonCode` 主入口 + 集成测**

在 `pythonAnalyzer.ts` 末尾加:

```ts
/** 主入口:合并所有文件做整体扫描 */
export function analyzePythonCode(files: SourceFile[]): PythonAnalysis {
  const merged = stripComments(files.map((f) => f.content).join('\n'));
  const symbols = buildSymbolTable(merged);
  const bindings = buildBindingTable(merged, symbols);
  const { gpios, ambiguous } = extractGpios(merged, symbols, bindings);
  return {
    language: 'python',
    detectedLibraries: extractLibraries(merged),
    detectedGpios: gpios,
    detectedPeripherals: extractPeripherals(merged),
    ambiguousReferences: ambiguous,
  };
}
```

测试文件追加:

```ts
import { analyzePythonCode } from './pythonAnalyzer';

describe('analyzePythonCode (integration)', () => {
  it('MicroPython ESP32 典型样本', () => {
    const code = `
from machine import Pin, I2C
import dht
LED_PIN = const(2)
led = Pin(LED_PIN, Pin.OUT)
sensor = dht.DHT22(Pin(15))
i2c = I2C(0, scl=Pin(22), sda=Pin(21))
led.value(1)
`;
    const r = analyzePythonCode([{ path: 'main.py', content: code }]);
    expect(r.language).toBe('python');
    expect(r.detectedLibraries).toEqual(['dht']);
    expect(r.detectedPeripherals).toContain('I2C');
    const ledGpio = r.detectedGpios.find(g => g.pin === '2');
    expect(ledGpio?.direction).toBe('output');
  });

  it('CircuitPython 典型样本', () => {
    const code = `
import board
import digitalio
import adafruit_dht
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT
led.value = True
sensor = adafruit_dht.DHT22(board.D4)
`;
    const r = analyzePythonCode([{ path: 'code.py', content: code }]);
    expect(r.detectedLibraries).toEqual(['adafruit_dht']);
    const ledGpio = r.detectedGpios.find(g => g.pin === 'LED');
    expect(ledGpio?.direction).toBe('output');
  });
});
```

Run: `npx vitest run src/extension/analyzers/pythonAnalyzer.test.ts`
Expected: 35 测全过。

- [ ] **Step 9: 整体测试套 + 类型自检**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 类型干净;总 195 测试全过(160 baseline + 35 新增)。

- [ ] **Step 10: Commit**

```bash
git add src/extension/analyzers/pythonAnalyzer.ts src/extension/analyzers/pythonAnalyzer.test.ts
git commit -m "feat(python-analyzer): MicroPython/CircuitPython 启发式扫描器

纯函数模块,含变量绑定表与方向反推:
- stripComments / buildSymbolTable / buildBindingTable
- extractGpios(三来源合并) / extractLibraries / extractPeripherals
- analyzePythonCode 主入口
- 35 测试覆盖 MicroPython + CircuitPython 典型场景"
```

---

## Task PY3: CodeAnalysisService — 双桶路由 + MixedCodeError(TDD)

**Files:**
- Modify: `src/extension/services/CodeAnalysisService.ts`
- Create: `src/extension/services/CodeAnalysisService.test.ts`

- [ ] **Step 1: 写服务测试桩(先红)**

`src/extension/services/CodeAnalysisService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as vscode from 'vscode';
import {
  CodeAnalysisService,
  MixedCodeError,
  NoCodeFilesError,
} from './CodeAnalysisService';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-code-analysis-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<void> {
  const full = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe('CodeAnalysisService', () => {
  it('纯 cpp 工程 → language=cpp', async () => {
    await writeFile('main.ino', '#include <Wire.h>\nvoid setup(){}');
    const svc = new CodeAnalysisService();
    const r = await svc.analyze(vscode.Uri.file(tmpRoot));
    expect(r.language).toBe('cpp');
  });

  it('纯 py 工程 → language=python', async () => {
    await writeFile('main.py', 'from machine import Pin\nled = Pin(2, Pin.OUT)');
    const svc = new CodeAnalysisService();
    const r = await svc.analyze(vscode.Uri.file(tmpRoot));
    expect(r.language).toBe('python');
  });

  it('混合工程 → 抛 MixedCodeError 含正确计数', async () => {
    await writeFile('a.ino', 'void setup(){}');
    await writeFile('b.ino', 'void loop(){}');
    await writeFile('tools/flash.py', 'print(1)');
    const svc = new CodeAnalysisService();
    await expect(svc.analyze(vscode.Uri.file(tmpRoot))).rejects.toMatchObject({
      name: 'MixedCodeError',
      cppCount: 2,
      pyCount: 1,
    });
  });

  it('空文件夹 → NoCodeFilesError', async () => {
    const svc = new CodeAnalysisService();
    await expect(svc.analyze(vscode.Uri.file(tmpRoot))).rejects.toBeInstanceOf(NoCodeFilesError);
  });

  it('analyzeWithLanguage(folder, python) 混合工程下只扫 py', async () => {
    await writeFile('a.ino', 'void setup(){}');
    await writeFile('tools/x.py', 'from machine import Pin\nled = Pin(2, Pin.OUT)');
    const svc = new CodeAnalysisService();
    const r = await svc.analyzeWithLanguage(vscode.Uri.file(tmpRoot), 'python');
    expect(r.language).toBe('python');
    expect(r.scannedFiles).toBe(1);
  });

  it('__pycache__ / .venv 被跳过', async () => {
    await writeFile('main.py', 'x = 1');
    await writeFile('__pycache__/main.cpython-310.pyc', 'should not count');
    await writeFile('.venv/lib/site.py', 'should not count');
    const svc = new CodeAnalysisService();
    const r = await svc.analyze(vscode.Uri.file(tmpRoot));
    expect(r.scannedFiles).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测验证红**

Run: `npx vitest run src/extension/services/CodeAnalysisService.test.ts`
Expected: 大量测试 FAIL — `MixedCodeError`/`NoCodeFilesError`/`analyzeWithLanguage` 都还不存在。

- [ ] **Step 3: 重写 `CodeAnalysisService.ts`**

整文件替换为:

```ts
/**
 * 代码分析编排服务 — 遍历文件夹,按扩展名分桶,单语言走对应分析器;混合工程抛 MixedCodeError。
 * 文件 I/O 与上限控制在此;纯提取逻辑在 analyzers/{arduinoAnalyzer,pythonAnalyzer}.ts。
 */
import * as vscode from 'vscode';
import type { CodeAnalysisResult } from '@shared/types';
import { analyzeArduinoCode, type SourceFile } from '../analyzers/arduinoAnalyzer';
import { analyzePythonCode } from '../analyzers/pythonAnalyzer';

/** C/C++ 源码扩展名 */
const CPP_EXTENSIONS = ['.ino', '.c', '.cpp', '.cc', '.h', '.hpp'];
/** Python 源码扩展名(.pyi 是类型存根,跳过) */
const PY_EXTENSIONS = ['.py'];
/** 遍历时跳过的目录 */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'build', '.pio', 'out', 'dist',
  '__pycache__', '.venv', 'venv', 'env', '.pytest_cache', '.mypy_cache', '.tox',
]);
/** 扫描上限(两桶共享) */
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/** 文件夹内无 Arduino 或 Python 源码 */
export class NoCodeFilesError extends Error {
  constructor() {
    super('未在该文件夹找到 Arduino 或 MicroPython/CircuitPython 代码文件(.ino/.c/.cpp/.h/.py)');
    this.name = 'NoCodeFilesError';
  }
}

/** 混合工程:同时包含 cpp 与 py */
export class MixedCodeError extends Error {
  constructor(public cppCount: number, public pyCount: number) {
    super(`检测到混合工程:${cppCount} 个 C/C++ 文件 + ${pyCount} 个 Python 文件,请选择主语言`);
    this.name = 'MixedCodeError';
  }
}

type CollectResult = { cppFiles: SourceFile[]; pyFiles: SourceFile[]; truncated: boolean };

export class CodeAnalysisService {
  /**
   * 遍历文件夹 → 收集源码 → 路由到对应分析器。
   * - 双桶都空 → NoCodeFilesError
   * - 双桶都非空 → MixedCodeError(含计数)
   * - 单桶非空 → 走对应分析器
   */
  async analyze(folderUri: vscode.Uri): Promise<CodeAnalysisResult> {
    const { cppFiles, pyFiles, truncated } = await this._collect(folderUri, 'both');
    if (cppFiles.length === 0 && pyFiles.length === 0) throw new NoCodeFilesError();
    if (cppFiles.length > 0 && pyFiles.length > 0) {
      throw new MixedCodeError(cppFiles.length, pyFiles.length);
    }
    if (cppFiles.length > 0) {
      const a = analyzeArduinoCode(cppFiles);
      return { ...a, scannedFiles: cppFiles.length, truncated };
    } else {
      const a = analyzePythonCode(pyFiles);
      return { ...a, scannedFiles: pyFiles.length, truncated };
    }
  }

  /** 在已知主语言的情况下二次分析:只收对应扩展名,空则抛 NoCodeFilesError */
  async analyzeWithLanguage(
    folderUri: vscode.Uri,
    language: 'cpp' | 'python',
  ): Promise<CodeAnalysisResult> {
    const { cppFiles, pyFiles, truncated } = await this._collect(folderUri, language);
    const files = language === 'cpp' ? cppFiles : pyFiles;
    if (files.length === 0) throw new NoCodeFilesError();
    if (language === 'cpp') {
      const a = analyzeArduinoCode(files);
      return { ...a, scannedFiles: files.length, truncated };
    } else {
      const a = analyzePythonCode(files);
      return { ...a, scannedFiles: files.length, truncated };
    }
  }

  /** 遍历目录,按扩展名分桶 */
  private async _collect(
    folderUri: vscode.Uri,
    mode: 'both' | 'cpp' | 'python',
  ): Promise<CollectResult> {
    const cppFiles: SourceFile[] = [];
    const pyFiles: SourceFile[] = [];
    let totalBytes = 0;
    let truncated = false;

    const walk = async (dir: vscode.Uri): Promise<void> => {
      if (cppFiles.length + pyFiles.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
        truncated = true;
        return;
      }
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        return;
      }
      for (const [name, type] of entries) {
        if (cppFiles.length + pyFiles.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
          truncated = true;
          return;
        }
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          if (!SKIP_DIRS.has(name)) await walk(child);
        } else if (type === vscode.FileType.File) {
          const dot = name.lastIndexOf('.');
          const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
          const isCpp = CPP_EXTENSIONS.includes(ext);
          const isPy = PY_EXTENSIONS.includes(ext);
          if (!isCpp && !isPy) continue;
          if (mode === 'cpp' && !isCpp) continue;
          if (mode === 'python' && !isPy) continue;
          try {
            const bytes = await vscode.workspace.fs.readFile(child);
            totalBytes += bytes.byteLength;
            const sf: SourceFile = {
              path: child.fsPath,
              content: Buffer.from(bytes).toString('utf-8'),
            };
            (isCpp ? cppFiles : pyFiles).push(sf);
          } catch {
            // 单文件不可读 → 跳过
          }
        }
      }
    };

    await walk(folderUri);
    return { cppFiles, pyFiles, truncated };
  }
}
```

注意:导出 `NoArduinoFilesError` 已删除。下游(`activate.ts`)需要相应更新(Task PY4),但本任务的 service test 不依赖 `NoArduinoFilesError` 名,所以不会被本任务测出。

- [ ] **Step 4: 跑测验证绿**

Run: `npx vitest run src/extension/services/CodeAnalysisService.test.ts`
Expected: 6 测全过。

- [ ] **Step 5: 改 `InputService.ts` 文案 + 加测**

`src/extension/services/InputService.ts` 第 98-100 行,把 `langLabel` 改为:

```ts
    const langLabel: Record<CodeAnalysisResult['language'], string> = {
      cpp: 'Arduino C/C++', c: 'C', python: 'MicroPython/CircuitPython',
    };
```

`src/extension/services/InputService.test.ts` 末尾加:

```ts
import { InputService } from './InputService';
import type { CodeAnalysisResult } from '@shared/types';

describe('InputService.fromCodeAnalysis — Python', () => {
  it('Python 结果 rawText 含 MicroPython/CircuitPython 标签', () => {
    const result: CodeAnalysisResult = {
      language: 'python',
      detectedGpios: [],
      detectedLibraries: ['dht'],
      detectedPeripherals: [],
      ambiguousReferences: [],
      scannedFiles: 1,
      truncated: false,
    };
    const req = new InputService().fromCodeAnalysis(result);
    expect(req.rawText).toContain('MicroPython/CircuitPython');
  });

  it('Python truncated 注释注入', () => {
    const result: CodeAnalysisResult = {
      language: 'python',
      detectedGpios: [],
      detectedLibraries: [],
      detectedPeripherals: [],
      ambiguousReferences: [],
      scannedFiles: 200,
      truncated: true,
    };
    const req = new InputService().fromCodeAnalysis(result);
    expect(req.rawText).toContain('代码量超出扫描上限');
  });
});
```

- [ ] **Step 6: 跑全套**

Run: `npm test`
Expected: 总 ~203 测试全过(195 + 6 service + 2 InputService 新加)。
注:实际数字以本地为准,以"测试增加 8 且无失败"为合格判据。

- [ ] **Step 7: 类型自检**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 干净通过。

- [ ] **Step 8: Commit**

```bash
git add src/extension/services/CodeAnalysisService.ts src/extension/services/CodeAnalysisService.test.ts src/extension/services/InputService.ts src/extension/services/InputService.test.ts
git commit -m "feat(code-analysis-service): 双桶路由 + MixedCodeError + Python 文案

- 重写 CodeAnalysisService:按扩展名分桶,共享 MAX_FILES/MAX_TOTAL_BYTES
- 重命名 NoArduinoFilesError → NoCodeFilesError(文案包含 .py)
- 新 analyzeWithLanguage(folderUri, language) 二次分析入口
- 新 MixedCodeError 含 cppCount/pyCount
- SKIP_DIRS 新增 __pycache__/.venv/venv/env/.pytest_cache/.mypy_cache/.tox
- InputService.langLabel.python: 'Python' → 'MicroPython/CircuitPython'"
```

---

## Task PY4: activate.ts handler 改造

**Files:**
- Modify: `src/extension/activate.ts`

- [ ] **Step 1: 改 `pick_code_folder` 分支处理 `MixedCodeError`**

文件顶部 import 添加:

```ts
import { CodeAnalysisService, MixedCodeError } from './services/CodeAnalysisService';
```

(原 import 只有 `CodeAnalysisService`,这里把 `MixedCodeError` 一并引入)

把 `case 'pick_code_folder':` 分支(当前 159-195 行)整段替换为:

```ts
      case 'pick_code_folder': {
        Promise.resolve(vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: '选择固件代码文件夹',
        })).then((picked) => {
          if (!picked || picked.length === 0) {
            sidePanelProvider.postMessage({
              type: 'code_analysis_failed',
              source: 'extension',
              payload: { message: '未选择文件夹' },
              timestamp: Date.now(),
            });
            return;
          }
          const folderUri = picked[0];
          return codeAnalysisService.analyze(folderUri).then((result) => {
            sidePanelProvider.postMessage({
              type: 'code_analysis_result',
              source: 'extension',
              payload: { result },
              timestamp: Date.now(),
            });
            outputChannel.appendLine(`[code-analysis] scanned ${result.scannedFiles} files`);
          }).catch((err) => {
            if (err instanceof MixedCodeError) {
              sidePanelProvider.postMessage({
                type: 'code_analysis_mixed',
                source: 'extension',
                payload: {
                  folderUri: folderUri.toString(),
                  cppCount: err.cppCount,
                  pyCount: err.pyCount,
                },
                timestamp: Date.now(),
              });
              outputChannel.appendLine(`[code-analysis] mixed cpp=${err.cppCount} py=${err.pyCount}`);
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            sidePanelProvider.postMessage({
              type: 'code_analysis_failed',
              source: 'extension',
              payload: { message: msg },
              timestamp: Date.now(),
            });
            outputChannel.appendLine(`[code-analysis] error: ${msg}`);
          });
        });
        break;
      }
```

- [ ] **Step 2: 在 `submit_code_analysis` 后追加 `select_code_language` handler**

紧接 `case 'submit_code_analysis': { ... }` 之后(204 行附近)加:

```ts
      case 'select_code_language': {
        const folderUri = vscode.Uri.parse(message.payload.folderUri);
        const { language } = message.payload;
        codeAnalysisService.analyzeWithLanguage(folderUri, language).then((result) => {
          sidePanelProvider.postMessage({
            type: 'code_analysis_result',
            source: 'extension',
            payload: { result },
            timestamp: Date.now(),
          });
          outputChannel.appendLine(`[code-analysis] selected ${language}, scanned ${result.scannedFiles} files`);
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          sidePanelProvider.postMessage({
            type: 'code_analysis_failed',
            source: 'extension',
            payload: { message: msg },
            timestamp: Date.now(),
          });
          outputChannel.appendLine(`[code-analysis] select error: ${msg}`);
        });
        break;
      }
```

- [ ] **Step 3: 类型自检 + 编译**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 类型 OK;esbuild 产出 extension/panel/report 三 bundle 无错。

- [ ] **Step 4: 跑测**

Run: `npm test`
Expected: 与 Task PY3 完成后保持相同绿数(activate.ts 暂无新单测,行为靠手测覆盖)。

- [ ] **Step 5: Commit**

```bash
git add src/extension/activate.ts
git commit -m "feat(activate): MixedCodeError 分支 + select_code_language handler"
```

---

## Task PY5: inputStore — `'mixed'` 状态 + 新字段

**Files:**
- Modify: `src/webview/panel/store/inputStore.ts`

- [ ] **Step 1: 加 status / state / setter**

把第 7 行 `export type CodeAnalysisStatus` 改为:

```ts
export type CodeAnalysisStatus = 'idle' | 'scanning' | 'ready' | 'failed' | 'mixed';
```

把第 9-37 行 `InputState` 接口的 codeAnalysis 部分(19-21 行)扩展为:

```ts
  codeAnalysisStatus: CodeAnalysisStatus;
  codeAnalysisResult: CodeAnalysisResult | null;
  codeAnalysisError: string;
  codeAnalysisFolderUri: string | null;
  codeAnalysisMixedInfo: { cppCount: number; pyCount: number } | null;
```

并在 setter 列表(32-35 行)加:

```ts
  setCodeAnalysisScanning: (folderUri?: string) => void;
  setCodeAnalysisResult: (result: CodeAnalysisResult) => void;
  setCodeAnalysisFailed: (message: string) => void;
  setCodeAnalysisMixed: (folderUri: string, cppCount: number, pyCount: number) => void;
  resetCodeAnalysis: () => void;
```

注意 `setCodeAnalysisScanning` 签名变为 `(folderUri?: string) => void`。

- [ ] **Step 2: 实现 setter**

把 store 实现(48-50 行的初值 + 95-98 行的 setter)整段替换为:

```ts
  codeAnalysisStatus: 'idle',
  codeAnalysisResult: null,
  codeAnalysisError: '',
  codeAnalysisFolderUri: null,
  codeAnalysisMixedInfo: null,
```

```ts
  setCodeAnalysisScanning: (folderUri) => set({
    codeAnalysisStatus: 'scanning',
    codeAnalysisResult: null,
    codeAnalysisError: '',
    codeAnalysisMixedInfo: null,
    codeAnalysisFolderUri: folderUri ?? null,   // 不传则清(新一轮 picker 触发);传则保留(LanguagePicker 触发)
  }),
  setCodeAnalysisResult: (result) => set({
    codeAnalysisStatus: 'ready',
    codeAnalysisResult: result,
    codeAnalysisError: '',
    codeAnalysisMixedInfo: null,
  }),
  setCodeAnalysisFailed: (message) => set({
    codeAnalysisStatus: 'failed',
    codeAnalysisResult: null,
    codeAnalysisError: message,
    codeAnalysisMixedInfo: null,
  }),
  setCodeAnalysisMixed: (folderUri, cppCount, pyCount) => set({
    codeAnalysisStatus: 'mixed',
    codeAnalysisFolderUri: folderUri,
    codeAnalysisMixedInfo: { cppCount, pyCount },
    codeAnalysisResult: null,
    codeAnalysisError: '',
  }),
  resetCodeAnalysis: () => set({
    codeAnalysisStatus: 'idle',
    codeAnalysisResult: null,
    codeAnalysisError: '',
    codeAnalysisFolderUri: null,
    codeAnalysisMixedInfo: null,
  }),
```

同步 `loadSession` 与 `clearChat` 两个 reset 块(109-110 行 + 116-117 行)各加两个新字段:

```ts
  codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '',
  codeAnalysisFolderUri: null, codeAnalysisMixedInfo: null,
```

- [ ] **Step 3: `CodeFolderPicker.tsx` 同步**

`setScanning` 调用现在可选传 URI,但 picker 触发时还没 URI(URI 来自后端 dialog 返回),所以保留无参调用即可:

```ts
const handlePick = useCallback(() => {
  setScanning();   // 无参,清掉旧 folderUri
  const message: PanelToExtension = createMessage('pick_code_folder', 'panel', undefined);
  vscodeApi.postMessage(message);
}, [setScanning]);
```

这是已有逻辑,不变。验证此文件未被影响。

- [ ] **Step 4: 类型自检 + 测**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 通过(测试数与 PY3 后相同;store 无独立单测覆盖,后续 PY7 路由测验证)。

- [ ] **Step 5: Commit**

```bash
git add src/webview/panel/store/inputStore.ts
git commit -m "feat(input-store): 加 'mixed' 状态 + folderUri/mixedInfo 字段

- CodeAnalysisStatus 联合加 'mixed'
- 新字段 codeAnalysisFolderUri / codeAnalysisMixedInfo
- setCodeAnalysisScanning 签名变为可选 folderUri
- 新 setter setCodeAnalysisMixed(folderUri, cppCount, pyCount)
- 不变式:setResult/setFailed/setMixed 清空 mixedInfo 互斥项"
```

---

## Task PY6: CodeLanguagePicker 组件 + 样式

**Files:**
- Create: `src/webview/panel/components/CodeLanguagePicker.tsx`
- Create: `src/webview/panel/components/CodeLanguagePicker.css`

- [ ] **Step 1: 写组件**

`src/webview/panel/components/CodeLanguagePicker.tsx`:

```tsx
/** 混合工程语言选择器 — codeAnalysisStatus === 'mixed' 时渲染 */
import React, { useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './CodeLanguagePicker.css';

export function CodeLanguagePicker(): React.ReactElement {
  const folderUri = useInputStore((s) => s.codeAnalysisFolderUri);
  const info = useInputStore((s) => s.codeAnalysisMixedInfo);
  const setScanning = useInputStore((s) => s.setCodeAnalysisScanning);
  const reset = useInputStore((s) => s.resetCodeAnalysis);

  const choose = useCallback((language: 'cpp' | 'python') => {
    if (!folderUri) return;
    setScanning(folderUri);
    const msg: PanelToExtension = createMessage('select_code_language', 'panel', {
      folderUri,
      language,
    });
    vscodeApi.postMessage(msg);
  }, [folderUri, setScanning]);

  if (!info || !folderUri) {
    return <div className="code-lang-picker">状态错误,请重选文件夹</div>;
  }

  return (
    <div className="code-lang-picker">
      <p className="code-lang-picker__title">检测到混合工程</p>
      <ul className="code-lang-picker__counts">
        <li>C/C++ 文件:<b>{info.cppCount}</b> 个</li>
        <li>Python 文件:<b>{info.pyCount}</b> 个</li>
      </ul>
      <p className="code-lang-picker__hint">请选择按哪个语言分析:</p>
      <div className="code-lang-picker__actions">
        <button className="code-lang-picker__btn" onClick={() => choose('cpp')}>
          按 Arduino 分析
        </button>
        <button className="code-lang-picker__btn" onClick={() => choose('python')}>
          按 MicroPython 分析
        </button>
      </div>
      <button className="code-lang-picker__cancel" onClick={reset}>
        取消重选文件夹
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 写样式**

`src/webview/panel/components/CodeLanguagePicker.css`:

```css
.code-lang-picker {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.code-lang-picker__title {
  font-weight: 600;
  color: var(--eda-fg);
  margin: 0;
}

.code-lang-picker__counts {
  margin: 0;
  padding-left: 16px;
  color: var(--eda-fg);
}

.code-lang-picker__hint {
  margin: 0;
  color: var(--eda-fg-muted);
  font-size: 0.92em;
}

.code-lang-picker__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.code-lang-picker__btn {
  flex: 1 1 auto;
  padding: 6px 12px;
  background: var(--eda-btn-bg);
  color: var(--eda-btn-fg);
  border: 1px solid var(--eda-btn-border);
  border-radius: 3px;
  cursor: pointer;
}

.code-lang-picker__btn:hover {
  background: var(--eda-btn-bg-hover);
}

.code-lang-picker__cancel {
  align-self: flex-start;
  padding: 4px 8px;
  background: transparent;
  color: var(--eda-fg-muted);
  border: none;
  cursor: pointer;
  font-size: 0.88em;
}

.code-lang-picker__cancel:hover {
  color: var(--eda-fg);
  text-decoration: underline;
}
```

- [ ] **Step 3: 类型自检 + 编译**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 干净通过(组件未被引用,但模块本身能编译)。

- [ ] **Step 4: Commit**

```bash
git add src/webview/panel/components/CodeLanguagePicker.tsx src/webview/panel/components/CodeLanguagePicker.css
git commit -m "feat(webview): CodeLanguagePicker 组件

混合工程时显示 cpp/py 文件计数,两按钮选主语言 →
postMessage select_code_language { folderUri, language } + 本地 scanning;
取消按钮 resetCodeAnalysis 回 idle。"
```

---

## Task PY7: PanelApp — 'mixed' 路由 + 新消息 handler

**Files:**
- Modify: `src/webview/panel/PanelApp.tsx`

- [ ] **Step 1: import 新组件 + 新 setter**

`src/webview/panel/PanelApp.tsx` 顶部:

```tsx
import { CodeLanguagePicker } from './components/CodeLanguagePicker';
```

并在已有 `useInputStore` 选择器里加:

```tsx
  const setCodeAnalysisMixed = useInputStore((s) => s.setCodeAnalysisMixed);
```

放在第 34 行 `setCodeAnalysisFailed` 之后。

- [ ] **Step 2: 加新 message handler**

在 `useEffect` 内的 `switch (msg.type)` 块里,紧接 `case 'code_analysis_failed':` 之后加:

```ts
        case 'code_analysis_mixed':
          setCodeAnalysisMixed(msg.payload.folderUri, msg.payload.cppCount, msg.payload.pyCount);
          break;
```

并把 `useEffect` 的依赖数组(第 81 行)末尾加 `setCodeAnalysisMixed`:

```ts
  }, [addMessage, appendToLastMessage, setStatus, setIsGenerating, loadSession, clearChat, setSessionInfo, setCodeAnalysisResult, setCodeAnalysisFailed, setCodeAnalysisMixed]);
```

- [ ] **Step 3: 改 mode === 'code' 路由(122-126 行)**

把:

```tsx
        {mode === 'code' && (
          codeAnalysisStatus === 'ready'
            ? <CodeAnalysisPreview />
            : <CodeFolderPicker />
        )}
```

改为:

```tsx
        {mode === 'code' && (() => {
          switch (codeAnalysisStatus) {
            case 'ready': return <CodeAnalysisPreview />;
            case 'mixed': return <CodeLanguagePicker />;
            default:      return <CodeFolderPicker />;
          }
        })()}
```

- [ ] **Step 4: 更新 JSDoc 头注释**

把第 18 行 `* Phase 8:三模式输入(Chat / Form / Code)+ Zustand 状态管理` 后追加一行:

```
 * Phase 8 V2:Code 模式支持 MicroPython/CircuitPython + 混合工程弹选择器
```

- [ ] **Step 5: 类型自检 + 编译**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 干净通过。

- [ ] **Step 6: 跑测**

Run: `npm test`
Expected: 仍是 Task PY3 完成后的数量,无新增也无失败。

- [ ] **Step 7: Commit**

```bash
git add src/webview/panel/PanelApp.tsx
git commit -m "feat(panel-app): code 模式 'mixed' 路由 + code_analysis_mixed handler

- 接收 code_analysis_mixed → setCodeAnalysisMixed
- mode==='code' 路由改用 switch(ready→Preview / mixed→LanguagePicker / 其余→FolderPicker)
- JSDoc 标注 Phase 8 V2 扩展"
```

---

## Task PY8: 终检 + 文档同步 + 打包

**Files:**
- Modify: `progress.txt`
- Modify: `docs/IMPLEMENTATION_PLAN.md`
- 验证打包

- [ ] **Step 1: 完整测试 + 类型自检 + 编译**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npm test
npm run build
```
Expected:
- 类型干净
- 总测试 ≥ 203 全过(160 baseline + 35 pythonAnalyzer + 6 service + 2 InputService = 203)
- esbuild 三 bundle 无错

- [ ] **Step 2: 手测 — 纯 MicroPython 工程**

```bash
mkdir -p /tmp/eda-test-mp
cat > /tmp/eda-test-mp/main.py <<'EOF'
from machine import Pin, I2C
import dht
LED_PIN = const(2)
led = Pin(LED_PIN, Pin.OUT)
sensor = dht.DHT22(Pin(15))
i2c = I2C(0, scl=Pin(22), sda=Pin(21))
led.value(1)
EOF
```

在 VS Code Extension Host (F5) 中:
- 切到 Code 模式 → 选 `/tmp/eda-test-mp` → 预览应:
  - 语言 = python
  - 库 = dht
  - 外设 = I2C
  - GPIO:2 (output)、15、21、22

记录结果到 commit 备注。

- [ ] **Step 3: 手测 — 纯 CircuitPython 工程**

```bash
mkdir -p /tmp/eda-test-cp
cat > /tmp/eda-test-cp/code.py <<'EOF'
import board
import digitalio
import adafruit_dht
led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT
led.value = True
sensor = adafruit_dht.DHT22(board.D4)
EOF
```

预览应:
- 库 = adafruit_dht
- GPIO:D13 (output)
- pin 字段不带 `board.` 前缀

- [ ] **Step 4: 手测 — 混合工程**

```bash
mkdir -p /tmp/eda-test-mix/tools
cp -r /tmp/eda-test-mp/main.py /tmp/eda-test-mix/tools/flash.py
cat > /tmp/eda-test-mix/main.ino <<'EOF'
#include <Arduino.h>
void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, HIGH); }
EOF
```

- 选文件夹 → 应弹 `CodeLanguagePicker`,显示 C/C++=1、Python=1
- 选"按 Arduino 分析" → 预览语言=cpp,GPIO=13 output
- 重选,选"按 MicroPython 分析" → 预览语言=python

- [ ] **Step 5: 更新 `progress.txt`**

在文件末尾追加(替换原"下一步"段为新版):

```
=== 2026-05-24 Phase 8 V2:Python/MicroPython 代码分析 完成 ===

实现 MicroPython + CircuitPython 启发式扫描,扩展 Phase 8 V1 的代码分析框架:
- pythonAnalyzer.ts 纯函数模块(symbol table + 变量绑定追踪 + 三来源 GPIO 合并)
- CodeAnalysisService 双桶路由 + MixedCodeError + analyzeWithLanguage
- 混合工程在 Webview 弹 CodeLanguagePicker 让用户选主语言
- 35 单测 + 6 service 测 + 2 InputService 测覆盖

文件改动:8 新增/修改,~600+ 行代码。
测试:203 测试全绿(160 V1 基线 + 43 新增)。
分支:feat/phase8v2/python-code-analysis(待合并到 main)。

### 下一步
- 多方案并排对比视图(Phase 7 §9 遗留项)
- SessionStorageService / SessionManager 单元测试补充
```

- [ ] **Step 6: 更新 `docs/IMPLEMENTATION_PLAN.md` §10.4**

把 Python 那一项的 `[ ]` 改为 `[x]`,并在条目末尾追加 `(完成 2026-05-24,见 docs/superpowers/specs/2026-05-24-python-code-analysis-design.md)`。

- [ ] **Step 7: vsce 打包验证**

Run: `npx vsce package --no-yarn`
Expected: 产出 `.vsix`,文件数 ≥ 9(因新增 CodeLanguagePicker),大小相比 V1 (262.92 KB) 略增 ≤ +30 KB。

- [ ] **Step 8: Final Commit**

```bash
git add progress.txt docs/IMPLEMENTATION_PLAN.md
git commit -m "chore(python-analysis): Phase 8 V2 终检 + 文档同步

- progress.txt 加 Phase 8 V2 完成条目;下一步换为多方案对比 / Session 测试
- IMPLEMENTATION_PLAN.md §10.4 Python 项打勾
- 手测三场景通过:纯 MicroPython / 纯 CircuitPython / 混合工程"
```

- [ ] **Step 9: 合并到 main(参考 superpowers:finishing-a-development-branch)**

按 CLAUDE.md §15.4 收尾:

```bash
# 在 worktree 外的主仓
cd /Users/mac/Desktop/Code/AI_EDA_Copilot-main
git checkout main
git merge --no-ff feat/phase8v2/python-code-analysis -m "合并 feat/phase8v2/python-code-analysis:Python 代码分析"
git -c http.version=HTTP/1.1 push origin main
# 删分支与 worktree(若隔离工作区)
git worktree remove <worktree-path>
git branch -d feat/phase8v2/python-code-analysis
```

---

## 自检备忘

- [x] **Spec coverage:** spec §3/§4/§5/§6/§7/§8/§9/§10/§11/§12 全部对应到 PY1-PY8 任务。spec §1/§2/§13 是边界/决策声明,无需独立任务。
- [x] **Placeholder scan:** 无 TBD/TODO,所有代码片段完整。
- [x] **Type consistency:** `CodeAnalysisStatus` 在 store/PanelApp 都加 `'mixed'`;`MixedCodeError` 的 `cppCount`/`pyCount` 在 service/activate/message/store 命名一致;`folderUri` 字符串协议在 message/activate/store/picker 一致;`setCodeAnalysisScanning` 在 store 改为 `(folderUri?: string)` 后 `CodeFolderPicker` 的无参调用仍合法(可选参)。
