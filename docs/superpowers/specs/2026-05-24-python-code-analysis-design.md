# Python 代码分析(MicroPython + CircuitPython)设计文档

- 日期:2026-05-24
- 状态:已确认设计,待写实现计划
- 范围对应:`IMPLEMENTATION_PLAN.md` §10.4(Phase 8 — 代码分析输入,Python 扩展项)
- 前置:`2026-05-21-code-analysis-input-design.md`(Arduino V1 已实现并合并 `86151e8`)

## 1. 目标与边界

### 1.1 目标

把 Phase 8 已落地的"选文件夹→本地扫描→预览→注入需求管线"流程从 Arduino C/C++ 扩展到 **MicroPython + CircuitPython**,使两类嵌入式 Python 工程也能产出 `CodeAnalysisResult` 并复用既有 UI 与下游管线。

### 1.2 V1 边界(YAGNI)

- **仅 MicroPython + CircuitPython**:识别 `machine.*`(MicroPython)与 `board / digitalio / analogio / busio / pwmio`(CircuitPython)两套生态。
- **明确不支持**:RPi.GPIO、gpiozero、纯 CPython GPIO 库(本轮推迟)。
- **不做表达式求值**:`PIN = BASE + 1` 这类不进符号表,直接跳过。
- **不解析 `import ... as` 重命名**:`from machine import Pin as MyPin` 中的 `MyPin` 不会被视为 `Pin`(影响构造时方向识别,但绑定表后续 `.value()/.on()` 反推方向仍生效)。
- **轻量正则/模式扫描**:不构建 AST,不执行 Python。
- **提取不用 AI**:零 token 本地扫描。

## 2. 关键设计决策(已与用户确认)

| 决策点 | 选择 |
|--------|------|
| Python 生态范围 | MicroPython + CircuitPython;不含 RPi.GPIO/gpiozero |
| 混合工程(`.ino` + `.py` 同存) | Extension 抛 `MixedCodeError`,Webview 弹 `CodeLanguagePicker` 让用户选主语言,二次分析 |
| 符号追踪深度 | 模块级常量表 + 变量绑定表(`led = Pin(13)`)+ 后续调用反推方向 |
| 表达式求值 | 不做,跳过非整型直赋值 |
| `neopixel` 模块 | 列为"用户库",不进 stdlib 过滤集(虽 MicroPython 自带,但语义重要) |

## 3. 数据流

### 3.1 单一语言工程(无混合)

1. 用户切到代码模式 → `CodeFolderPicker` → 选文件夹。
2. Panel 发 `pick_code_folder`。
3. Extension `CodeAnalysisService.analyze(folderUri)` 一次性 walk,按扩展名分桶收 cpp/py 两组。
4. 单一桶非空 → 调对应 `analyzeArduinoCode` / `analyzePythonCode` → `CodeAnalysisResult` → `code_analysis_result` 消息 → Webview 显示 `CodeAnalysisPreview`。
5. 用户确认 → `submit_code_analysis { result, notes }` → `InputService.fromCodeAnalysis` → `runRequirementStage`(与 Arduino 完全一致)。

### 3.2 混合工程

1. 步骤 1-3 同上。
2. 两桶都非空 → 服务抛 `MixedCodeError(cppCount, pyCount)`。
3. activate 捕获 → 发 `code_analysis_mixed { folderUri, cppCount, pyCount }`。
4. Webview 渲染 `CodeLanguagePicker` 展示文件数,用户选"按 Arduino 分析"或"按 MicroPython 分析"。
5. Panel 发 `select_code_language { folderUri, language }`。
6. Extension `CodeAnalysisService.analyzeWithLanguage(folderUri, language)` 只收对应扩展名 → 走步骤 4-5。

失败/取消分支见 §10。

## 4. 数据模型

### 4.1 `CodeAnalysisResult` 不变

`language` 字段类型 `'c' | 'cpp' | 'python'` 已预留,V2 取值集补充 `'python'`(仅运行时值,不动类型)。`GpioUsage / AmbiguousRef / scannedFiles / truncated` 全部复用 Phase 8 V1 定义。

### 4.2 消息协议新增(`src/shared/types/messages.types.ts`)

```ts
// PanelToExtension
| BaseMessage<'select_code_language',
              { folderUri: string; language: 'cpp' | 'python' }>

// ExtensionToPanel
| BaseMessage<'code_analysis_mixed',
              { folderUri: string; cppCount: number; pyCount: number }>
```

`folderUri` 序列化方式:Extension 用 `vscode.Uri.toString()`,反向用 `vscode.Uri.parse()`。

### 4.3 Panel 状态扩展(`src/webview/panel/store/inputStore.ts`)

```ts
type CodeAnalysisStatus = 'idle' | 'scanning' | 'ready' | 'failed' | 'mixed'   // 加 'mixed'

interface InputState {
  // ... 现有 codeAnalysisStatus / codeAnalysisResult / codeAnalysisError
  codeAnalysisFolderUri: string | null
  codeAnalysisMixedInfo: { cppCount: number; pyCount: number } | null
}
```

不变式:`codeAnalysisStatus === 'mixed'` ⟺ `codeAnalysisMixedInfo !== null && codeAnalysisFolderUri !== null`。
非 'mixed' 状态:`codeAnalysisMixedInfo === null`。
'ready' / 'failed' / 'idle' 状态:`codeAnalysisFolderUri` 视情况(scanning 持有,idle 清空)。

## 5. `pythonAnalyzer.ts` 提取规则

### 5.1 公开接口(对称 arduinoAnalyzer)

```ts
export interface SourceFile { path: string; content: string }
export type PythonAnalysis = Omit<CodeAnalysisResult, 'scannedFiles' | 'truncated'>

export function stripComments(code: string): string
export function buildSymbolTable(code: string): Map<string, string>
export function buildBindingTable(
  code: string,
  symbols: Map<string, string>,
): Map<string, { pin: string; direction?: 'input' | 'output' }>
export function extractLibraries(code: string): string[]
export function extractGpios(
  code: string,
  symbols: Map<string, string>,
  bindings: Map<string, { pin: string; direction?: 'input' | 'output' }>,
): { gpios: GpioUsage[]; ambiguous: AmbiguousRef[] }
export function extractPeripherals(code: string): string[]
export function analyzePythonCode(files: SourceFile[]): PythonAnalysis
```

### 5.2 注释剥离

- 行注释 `# ... \n`(注意:字符串内 `#` 也会被剥,接受此限制 —— 对 import / 调用提取无实际影响)
- 三引号块 `''' ... '''` 与 `""" ... """`(用于 docstring)

### 5.3 符号表 `buildSymbolTable`

收两种句式,值必须是**整型字面量**:
```
NAME = <int>
NAME = const(<int>)            # MicroPython 习惯写法
```
重名只取首次;表达式赋值 (`A + B`, `0x10 | 1` 等) 跳过。

### 5.4 绑定表 `buildBindingTable`(本 Phase 新机制)

抓产生引脚句柄的句式,合成 `varName → { pin, direction? }`:

**MicroPython:**
```
NAME = Pin(<pin>, Pin.OUT)               → direction='output'
NAME = Pin(<pin>, Pin.IN)                → direction='input'
NAME = Pin(<pin>)                        → direction=undefined
NAME = machine.Pin(<pin>, ...)           → 同上
```

**CircuitPython:**
```
NAME = digitalio.DigitalInOut(<pin>)     → direction=undefined
NAME = analogio.AnalogIn(<pin>)          → direction='input'
NAME = analogio.AnalogOut(<pin>)         → direction='output'
NAME = pwmio.PWMOut(<pin>, ...)          → direction='output' + 触发 PWM 外设
NAME.direction = digitalio.Direction.OUTPUT   → 补 direction='output'
NAME.direction = digitalio.Direction.INPUT    → 补 direction='input'
```

`<pin>` 解析顺序:
1. 数字字面量(`13`、`0x10`)→ 原值
2. `board.XXX` → 去前缀作 pin 名(`board.D13` → `"D13"`, `board.LED` → `"LED"`)
3. 符号表命中 → 取值
4. 都不命中 → 保留原 token,加入 ambiguous

### 5.5 GPIO 用法 `extractGpios`

**来源 1:绑定表条目直接入账**
- 每个绑定都记 GPIO 用法,usage 文案 `<varName> · <constructor>`
- 若 binding 的 `direction` 为 `undefined`(如 `led = Pin(13)`)→ 入账方向为 `'unknown'`,等待来源 2 升级
- 若来源 2 后续给出明确方向 → 用来源 2 的方向覆盖 `'unknown'`(不算冲突)
- 若来源 1 已有明确方向、来源 2 给出相反方向 → 才视为冲突,合并为 `'unknown'`

**来源 2:绑定变量的方法/属性调用反推方向**(查绑定表得 pin):
| 调用 | 方向 |
|------|------|
| `NAME.value(<expr>)` / `.on()` / `.off()` / `.high()` / `.low()` | output |
| `NAME.value()` 无参 | input |
| `NAME.value = <expr>` (CircuitPython 属性赋值) | output |
| `NAME.irq(...)` | input |

**来源 3:直接出现的 API 调用(无变量绑定也抓)**
- `Pin(<pin>, Pin.OUT|Pin.IN)` 第一参 → 同方向
- `digitalio.DigitalInOut(<pin>)` / `analogio.AnalogIn(<pin>)` / `pwmio.PWMOut(<pin>)`

**合并:**同一 pin 多方向 → `'unknown'`(同 Arduino)。
**未解析 token:**进 `ambiguousReferences`,question 文案 `代码中 \`X\` 对应的实际 GPIO 引脚号是多少?`

### 5.6 库 `extractLibraries`

两种 import 句式:
```
import foo
import foo as f
import foo.bar           # 只记顶级 foo
from foo import x
from foo.bar import x    # 只记顶级 foo
```

**stdlib 过滤集**(并集后从用户库剔除):

```
MicroPython:
  machine, micropython, time, gc, os, sys, struct, binascii,
  network, socket, ssl, ubinascii, ujson, urequests, uasyncio,
  asyncio, framebuf, math, random, _thread, select

CircuitPython:
  board, digitalio, analogio, busio, pwmio, pulseio,
  microcontroller, supervisor, storage, usb_hid, displayio,
  terminalio, audioio, audiocore, audiomixer, audiopwmio,
  audiobusio, rotaryio, countio, keypad, touchio
```

**例外**:`neopixel` 不在过滤集(语义重要,展示给用户)。

### 5.7 外设 `extractPeripherals`

| 外设 | 触发 |
|------|------|
| I2C | `machine.I2C` \| `from machine import I2C` \| `busio.I2C` |
| SPI | `machine.SPI` \| `busio.SPI` |
| UART | `machine.UART` \| `busio.UART` |
| PWM | `machine.PWM` \| `pwmio.PWMOut` |
| ADC | `machine.ADC` \| `analogio.AnalogIn` |
| DAC | `analogio.AnalogOut` |
| WiFi | `import network` \| `network.WLAN` |
| BLE/蓝牙 | `import bluetooth` \| `import aioble` \| `bluetooth.BLE` |
| NeoPixel | `import neopixel` \| `NeoPixel(` |
| 显示 | `framebuf.FrameBuffer` \| `displayio.Display` \| `ssd1306` \| `adafruit_ssd1306` |

### 5.8 主入口 `analyzePythonCode`

```ts
const merged = files.map(f => stripComments(f.content)).join('\n')
const symbols = buildSymbolTable(merged)
const bindings = buildBindingTable(merged, symbols)
const { gpios, ambiguous } = extractGpios(merged, symbols, bindings)
return {
  language: 'python',
  detectedLibraries: extractLibraries(merged),
  detectedGpios: gpios,
  detectedPeripherals: extractPeripherals(merged),
  ambiguousReferences: ambiguous,
}
```

## 6. `CodeAnalysisService` 改造

### 6.1 常量

```ts
const CPP_EXTENSIONS = ['.ino', '.c', '.cpp', '.cc', '.h', '.hpp'];
const PY_EXTENSIONS  = ['.py'];                  // .pyi 是类型存根,跳过
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'build', '.pio', 'out', 'dist',
  '__pycache__', '.venv', 'venv', 'env', '.pytest_cache', '.mypy_cache', '.tox',
]);
// MAX_FILES / MAX_TOTAL_BYTES 不变(200 / 2MB,两组共享)
```

`lib/`(CircuitPython 第三方库目录)**不跳过** —— 用户常在此放自己代码;扫到的 import 顶层模块名一致无副作用。

### 6.2 `analyze(folderUri)` 重写

```ts
async analyze(folderUri): Promise<CodeAnalysisResult> {
  const cppFiles: SourceFile[] = [];
  const pyFiles:  SourceFile[] = [];
  let totalBytes = 0;
  let truncated = false;
  const walk = async (dir) => { /* 分扩展名分桶,共享 MAX_FILES/MAX_TOTAL_BYTES */ };
  await walk(folderUri);

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
```

### 6.3 `analyzeWithLanguage(folderUri, language)`(新增)

```ts
async analyzeWithLanguage(folderUri, language: 'cpp' | 'python'): Promise<CodeAnalysisResult>
```

同 `analyze`,但 walk 时只收对应扩展名;若结果为空抛 `NoCodeFilesError`。

### 6.4 错误类型

```ts
// 重命名(原 NoArduinoFilesError):
export class NoCodeFilesError extends Error {
  constructor() { super('未在该文件夹找到 Arduino 或 MicroPython/CircuitPython 代码文件(.ino/.c/.cpp/.h/.py)'); }
}
export class MixedCodeError extends Error {
  constructor(public cppCount: number, public pyCount: number) {
    super(`检测到混合工程:${cppCount} 个 C/C++ 文件 + ${pyCount} 个 Python 文件,请选择主语言`);
  }
}
```

activate 中捕获分支按 `instanceof` 分发到 `code_analysis_mixed` / `code_analysis_failed`。

## 7. activate.ts 三段 handler

```ts
case 'pick_code_folder': {
  const picked = await Promise.resolve(vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
  })).catch(() => undefined);
  if (!picked?.length) return;
  const folderUri = picked[0];
  try {
    const result = await codeAnalysisService.analyze(folderUri);
    panel.webview.postMessage(createMessage('code_analysis_result', 'extension', { result }));
  } catch (e) {
    if (e instanceof MixedCodeError) {
      panel.webview.postMessage(createMessage('code_analysis_mixed', 'extension', {
        folderUri: folderUri.toString(),
        cppCount: e.cppCount, pyCount: e.pyCount,
      }));
    } else {
      panel.webview.postMessage(createMessage('code_analysis_failed', 'extension', {
        message: e instanceof Error ? e.message : String(e),
      }));
    }
  }
  return;
}

case 'select_code_language': {                 // 新增
  const folderUri = vscode.Uri.parse(msg.payload.folderUri);
  try {
    const result = await codeAnalysisService.analyzeWithLanguage(folderUri, msg.payload.language);
    panel.webview.postMessage(createMessage('code_analysis_result', 'extension', { result }));
  } catch (e) {
    panel.webview.postMessage(createMessage('code_analysis_failed', 'extension', {
      message: e instanceof Error ? e.message : String(e),
    }));
  }
  return;
}

case 'submit_code_analysis': /* 不变,沿用 Phase 8 */
```

## 8. InputService 文案小调

`_codeContextToText` 的 `langLabel`:

```ts
const langLabel: Record<CodeAnalysisResult['language'], string> = {
  c:      'C',
  cpp:    'Arduino C/C++',
  python: 'MicroPython/CircuitPython',
};
```

`requirementPrompt.ts` rule 8 维持原通用文案,不绑特定语言。

## 9. Webview UI

### 9.1 `CodeLanguagePicker.tsx`(新)

```
┌─────────────────────────────────────────────┐
│  检测到混合工程                              │
│                                              │
│  C/C++ 文件:  N1 个                          │
│  Python 文件:  N2 个                          │
│                                              │
│  [ 按 Arduino 分析 ]  [ 按 MicroPython 分析 ]│
│                                              │
│              [取消重选文件夹]                │
└─────────────────────────────────────────────┘
```

- 选 Arduino → `select_code_language { folderUri, language: 'cpp' }` + 本地置 `scanning`(保留 folderUri)。
- 选 Python → 同上 language='python'。
- 取消 → 状态置 'idle',清 folderUri 与 mixedInfo。
- 配套 `.css` 复用 `--eda-*` 变量,与 `CodeFolderPicker.css` 同风格,≤50 行。

### 9.2 `PanelApp.tsx` 路由

```tsx
{mode === 'code' && (() => {
  switch (codeAnalysisStatus) {
    case 'ready': return <CodeAnalysisPreview />
    case 'mixed': return <CodeLanguagePicker />
    default:      return <CodeFolderPicker />   // idle / scanning / failed
  }
})()}
```

新增 message handler `code_analysis_mixed` → `setCodeAnalysisMixed(folderUri, cppCount, pyCount)`。

## 10. 错误 / 边界 / 不支持清单

| 情况 | 行为 |
|------|------|
| `LED = const(NAME)` (const 套符号) | 一跳解析,若 NAME 已知则承袭值 |
| `Pin(13, MODE_VAR)` (mode 是变量) | 方向 `'unknown'`,GPIO 仍录入 |
| `from machine import Pin as MyPin; led = MyPin(13)` | V1 不解析 as,led 进绑定表 direction=undefined,后续 `.value(1)` 仍能升级 |
| 多文件同名变量 | 全文件合并扫描,后写覆盖前写;接受此限制 |
| f-string / 复杂表达式作 pin 参数 | 不解析,该 binding 跳过 |
| `try: import machine except: ...` | import 提取不分支,无论是否在 try 块都计入 |
| docstring `"""..."""` 含示例代码 | stripComments 清掉,不会误抓 |
| 单文件超 MAX_TOTAL_BYTES | 同 Arduino:允许最后一个超限文件入栈;无后续条目 truncated=false |
| `.ipynb` notebook | V1 不支持 |
| 二进制 `.mpy` | V1 不支持 |

## 11. 测试计划

### 11.1 `pythonAnalyzer.test.ts` 目标 ≥18 测试

- stripComments:行注释、单引号块、双引号块、字符串内 # 行为说明
- buildSymbolTable:整赋值、const() 包裹、表达式跳过、重名取首次
- buildBindingTable:Pin(13, Pin.OUT) 含方向 / Pin(13) 无方向 / digitalio.DigitalInOut(board.D13) 去前缀 / .direction 后续升级 / analogio.AnalogIn=input / pwmio.PWMOut=output / Pin(LED_PIN) 经符号表
- extractGpios:.value(1)→output、.value() 无参→input、.on()/.off()→output、.irq→input、多方向→unknown、未解析→ambiguous
- extractLibraries:import / from import 两式、顶级模块去重、stdlib 过滤、neopixel 不过滤
- extractPeripherals:I2C 三形态、PWM 双形态、network→WiFi、外设去重

### 11.2 `CodeAnalysisService.test.ts` 新增 ≥6 测试

- 纯 cpp → 走 Arduino
- 纯 py → 走 Python(language='python')
- 混合 → 抛 MixedCodeError(counts 正确)
- 空 → NoCodeFilesError
- analyzeWithLanguage 在混合工程下只扫指定语言
- truncated 在 py 工程触发
- __pycache__ / .venv 被跳过

### 11.3 `InputService.test.ts` 新增 ≥2 测试

- Python 结果 → rawText 含 "MicroPython/CircuitPython"
- truncated 注释注入对 python 同样生效

### 11.4 手测三场景(extension host)

1. 纯 MicroPython ESP32 工程 → 预览检查 `machine.Pin / I2C` 抓到
2. 纯 CircuitPython 工程(`board.D13` + digitalio) → 预览检查 pin 名为 `D13`(不带 `board.`)
3. 混合工程(Arduino 主目录 + `tools/flash.py`) → 弹 `CodeLanguagePicker`,选 Arduino 后正常出预览

## 12. 文件改动一览

```
新增:
  src/extension/analyzers/pythonAnalyzer.ts
  src/extension/analyzers/pythonAnalyzer.test.ts
  src/extension/services/CodeAnalysisService.test.ts (若无)
  src/webview/panel/components/CodeLanguagePicker.tsx
  src/webview/panel/components/CodeLanguagePicker.css
  docs/superpowers/specs/2026-05-24-python-code-analysis-design.md (本文件)
  docs/superpowers/plans/2026-05-24-python-code-analysis.md (writing-plans 阶段产出)

修改:
  src/extension/services/CodeAnalysisService.ts
  src/extension/activate.ts
  src/extension/services/InputService.ts
  src/shared/types/messages.types.ts
  src/webview/panel/store/inputStore.ts
  src/webview/panel/PanelApp.tsx
  progress.txt
  docs/IMPLEMENTATION_PLAN.md (§10.4 Python 项打勾)
```

## 13. 范围外(不在本 spec)

- RPi.GPIO / gpiozero 支持
- AST 级解析(libcst / python-ast)
- 表达式求值
- `import as` 重命名追踪
- `.ipynb` notebook 支持
- 跨文件作用域 / class 内方法 self.xxx 绑定追踪
- 多方案对比视图(独立计划)
- Session 单测补充(独立计划)
