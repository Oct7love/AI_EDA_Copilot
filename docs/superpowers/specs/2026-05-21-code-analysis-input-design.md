# 代码分析输入 设计文档

- 日期：2026-05-21
- 状态：已确认设计，待写实现计划
- 范围对应：`IMPLEMENTATION_PLAN.md` §10（Phase 8 — 代码分析输入）

## 1. 目标与边界

### 1.1 目标

让用户选择 Workspace 中的 Arduino/ESP32 固件代码文件夹，本地扫描器提取硬件相关信息（GPIO 使用、库引用、外设配置），在侧边栏预览，用户确认后注入现有需求分析管线，生成完整报告。

### 1.2 V1 边界（YAGNI）

- **仅 Arduino/ESP32 C/C++**：`.ino / .c / .cpp / .cc / .h / .hpp`。Python（MicroPython/CircuitPython）明确推迟。
- **轻量正则/模式扫描**：不构建编译器级静态分析（无宏展开、无调用图、无预处理器求值）。
- **提取不用 AI**：扫描器是纯本地启发式。AI 仅用于下游既有的需求合成阶段（不变）。
- 不做交互式管线内问答：模糊引用走「预览面板 + 报告 openQuestions」。

## 2. 关键设计决策（已与用户确认）

| 决策点 | 选择 |
|--------|------|
| 语言/生态范围 | 仅 Arduino/ESP32 C/C++；Python 推迟 |
| 扫描结果进入管线方式 | 扫描 → 预览面板 → 用户确认 → 注入 |
| 提取引擎 | 本地启发式扫描器（正则/模式匹配），零 AI token |

## 3. 数据流

1. 用户在侧边栏 `InputModeToggle` 切到第三模式「代码」→ 显示 `CodeFolderPicker`。
2. 点「选择代码文件夹」→ panel 发 `pick_code_folder` 消息。
3. Extension：`vscode.window.showOpenDialog({ canSelectFolders: true })` → 用户选文件夹 → `CodeAnalysisService.analyze(folderUri)` 遍历收集 Arduino 文件（设上限）→ 读内容 → `arduinoAnalyzer.analyzeArduinoCode(files)` → `CodeAnalysisResult`。
4. Extension 发 `code_analysis_result { result }` → panel 显示 `CodeAnalysisPreview`。
5. 用户查看检测结果（GPIO/库/外设 + 模糊项），可填可选「补充说明」，点「用此分析生成报告」→ panel 发 `submit_code_analysis { result, notes }`。
6. Extension：`InputService.fromCodeAnalysis(result, notes)` → `AnalysisRequest`（`inputType: 'code_analysis'`，`codeContext: result`，`rawText` = 序列化的代码上下文 + notes）→ `pipeline.runRequirementStage(request)`。
7. 后续 BOM/原理图/PCB/采购/审查管线照常串联。模糊引用经 prompt 提示自然成为 `RequirementSpec.openQuestions`。

失败/取消分支见 §13。

## 4. 数据模型

### 4.1 类型变更（`src/shared/types/input.types.ts`）

`CodeAnalysisResult` / `GpioUsage` / `AmbiguousRef` 已存在（Phase 8 预定义桩）。本设计扩展 `CodeAnalysisResult` 两个展示用字段：

```ts
export interface CodeAnalysisResult {
  language: 'c' | 'cpp' | 'python';   // V1 恒为 'cpp'（Arduino）
  detectedGpios: GpioUsage[];
  detectedLibraries: string[];
  detectedPeripherals: string[];
  ambiguousReferences: AmbiguousRef[];
  scannedFiles: number;               // 新增：实际扫描的文件数（预览显示）
  truncated: boolean;                 // 新增：是否因上限截断
}
```

`GpioUsage`（不变）：`{ pin: string; direction: 'input' | 'output' | 'unknown'; usage: string }`
`AmbiguousRef`（不变）：`{ reference: string; possibleMeanings: string[]; question: string }`

`AnalysisRequest`（不变）：已有 `inputType: 'code_analysis'` 与 `codeContext?: CodeAnalysisResult`。

## 5. 扫描器纯逻辑（新建 `src/extension/analyzers/arduinoAnalyzer.ts`）

无 vscode 依赖的纯函数模块（对齐 `versionStore.ts` / `artifactParsers.ts` / `overviewDeriver.ts` 模式），可全量单测。

```ts
/** 待分析文件 */
export interface SourceFile { path: string; content: string; }

/** 主入口：纯函数，输入文件列表，输出分析结果（不含 scannedFiles/truncated，由编排层补） */
export function analyzeArduinoCode(files: SourceFile[]): Omit<CodeAnalysisResult, 'scannedFiles' | 'truncated'>;
```

内部子函数：

- **`buildSymbolTable(content)`** — 收集 `#define NAME VALUE` 与 `const int NAME = VALUE;` / `constexpr` / `#define LED 2`，建标识符→数值表（供引脚解析）。仅解析值为整数字面量或 `Ax` 形式的；值为表达式的不入表。
- **`extractLibraries(content)`** — 正则 `/#include\s*[<"]([^>"]+)[>"]/g` 收集所有头文件，去重；过滤掉系统/语言头噪声（`Arduino.h`、`stdint.h`、`stdio.h`、`stdlib.h`、`string.h`、`math.h` 等白名单过滤）。结果为头文件名数组。
- **`extractGpios(content, symbolTable)`** — 匹配以下 Arduino API，第一参数为引脚：
  - `pinMode(PIN, MODE)` → direction 由 MODE 定（`OUTPUT`→output；`INPUT`/`INPUT_PULLUP`/`INPUT_PULLDOWN`→input）
  - `digitalWrite(PIN, …)` / `analogWrite(PIN, …)` / `dacWrite(PIN, …)` / `ledcAttachPin(PIN, …)` → output
  - `digitalRead(PIN)` / `analogRead(PIN)` / `touchRead(PIN)` → input
  - `attachInterrupt(digitalPinToInterrupt(PIN), …)` → input
  - PIN 为整数字面量或 `Ax` → 直接用；为标识符且在 symbolTable → 解析为数值；为标识符但不在表 → 仍记一条 `GpioUsage`（`pin` = 标识符名，方向已知），并同时产出一条 `AmbiguousRef`。
  - 同一引脚多次出现 → 合并；方向冲突（既 input 又 output）→ direction 记 `unknown`。
  - `usage` = 简短来源描述（如 `"pinMode OUTPUT"` / `"analogRead"` / 标识符名）。
- **`extractPeripherals(content, libraries)`** — 由 API 调用 + 库名推断规范外设名：`Wire.`/`Wire.h`→`I2C`；`SPI.`/`SPI.h`→`SPI`；`Serial[1-3]?.begin`→`UART`；`WiFi.`/`WiFi.h`→`WiFi`；`BLE`/`BluetoothSerial`→`BLE/蓝牙`；`Servo`→`Servo`；`ledc*`/`analogWrite`→`PWM`；`dacWrite`→`DAC`；`analogRead`→`ADC`。去重。
- **`detectAmbiguous(...)`** — 收集无法解析为数值的引脚标识符：`reference` = 标识符，`possibleMeanings` = `['GPIO 引脚号未在 #define/const 中找到']`，`question` = `代码中 \`<ref>\` 对应的实际 GPIO 引脚号是多少？`。

多文件：symbolTable 跨文件合并（先扫所有文件的 define/const，再解析引用）。

## 6. 编排层（新建 `src/extension/services/CodeAnalysisService.ts`）

vscode 耦合，负责文件 I/O：

```ts
class CodeAnalysisService {
  /** 遍历文件夹 → 读 Arduino 文件 → 调 arduinoAnalyzer → 补 scannedFiles/truncated */
  async analyze(folderUri: vscode.Uri): Promise<CodeAnalysisResult>;
}
```

- 递归遍历 `folderUri`，匹配扩展名 `.ino .c .cpp .cc .h .hpp`。
- 跳过目录：`.git`、`node_modules`、`build`、`.pio`、`out`、`dist`。
- 上限：≤ 200 文件、累计 ≤ 2 MB。达上限即停，`truncated = true`。
- 单文件读失败 → 跳过续扫（不抛）。
- 无匹配文件 → 抛特定错误（编排层捕获转 `code_analysis_failed`）。

## 7. 输入层 + Prompt 注入

### 7.1 `InputService`（`src/extension/services/InputService.ts`）

新增：

```ts
fromCodeAnalysis(result: CodeAnalysisResult, notes?: string): AnalysisRequest
```

返回 `inputType: 'code_analysis'`、`codeContext: result`、`rawText` = `codeContextToText(result)` + 可选 notes。

`codeContextToText(result)` — 纯函数，序列化为可读块（中文标签），形如：

```
[代码分析结果 — 来自固件源码扫描]
语言: Arduino C/C++
检测到的库: WiFi.h, Adafruit_SSD1306.h, DHT.h
检测到的外设: WiFi, I2C, UART
检测到的 GPIO 使用:
- 引脚 2 (output) — LED_PIN
- 引脚 A0 (input) — analogRead
模糊引用（需用户确认）:
- SENSOR_PIN: GPIO 引脚号未在 #define/const 中找到
```

### 7.2 `requirementPrompt`（`src/extension/prompts/requirementPrompt.ts`）

`buildRequirementPrompt(userInput, language)` 签名不变 —— 代码上下文已由 `codeContextToText` 拼进 `rawText`，作为 `userInput` 传入即可。SYSTEM_PROMPT 末尾追加一条规则：

> 若输入含「[代码分析结果]」块：其中的库/外设/GPIO 为源码实证，视为高可信（`source: ai_inferred`，`confidence ≥ 0.9`）；「模糊引用」逐条加入 `openQuestions`（`priority: important`）。

## 8. 消息协议（`src/shared/types/messages.types.ts`）

- `PanelToExtension` 新增：
  - `pick_code_folder` — payload `void`（触发扩展弹文件夹选择框）
  - `submit_code_analysis` — payload `{ result: CodeAnalysisResult; notes: string }`
- `ExtensionToPanel` 新增：
  - `code_analysis_result` — payload `{ result: CodeAnalysisResult }`
  - `code_analysis_failed` — payload `{ message: string }`
- 既有 `analyze_workspace { folderPath }` 为 Phase 1 遗留占位、无 handler；本轮不复用、不删除（超范围），新增上述消息。
- **协议层 `mode` 字段不变**：`switch_mode` / `submit_requirement` 的 `mode` 保持 `'chat' | 'form'`。「代码」是面板本地 UI 模式（见 §9），不经协议传递。

## 9. Webview 前端（`src/webview/panel/`）

- **`components/InputModeToggle.tsx`（改）**：Chat / Form 增加第三段 **代码**。面板本地 UI 模式类型（`InputModeToggle` props + `inputStore.mode`）从 `'chat' | 'form'` 扩展为 `'chat' | 'form' | 'code'`。**仅面板本地**：切到「代码」不发 `switch_mode`，代码分析全程走专用 `pick_code_folder` / `submit_code_analysis` 消息；协议层 `mode`、`SessionManager.inputMode`、`SessionData.inputMode` 均不受影响。
- **`components/CodeFolderPicker.tsx`（新）**：「选择代码文件夹」按钮 + 加载中/空状态；点击发 `pick_code_folder`。
- **`components/CodeAnalysisPreview.tsx`（新）**：展示 `scannedFiles` 计数 + truncated 提示 + 检测到的库/外设/GPIO 列表 + 模糊引用列表 + 可选「补充说明」textarea + 「用此分析生成报告」确认按钮 + 「重选文件夹」。确认发 `submit_code_analysis`。
- **`store/inputStore.ts`（改）**：新增 `codeAnalysisResult: CodeAnalysisResult | null`、`codeAnalysisStatus: 'idle' | 'scanning' | 'ready' | 'failed'` + setter。
- **`PanelApp.tsx`（改）**：`mode === 'code'` 时输入区渲染 `CodeFolderPicker`（未扫描）或 `CodeAnalysisPreview`（已出结果）；处理 `code_analysis_result` / `code_analysis_failed` 消息。
- 样式遵循现有 `--eda-*` CSS 变量，不硬编码颜色。

## 10. Extension 接线（`src/extension/activate.ts`）

- `pick_code_folder` handler：`showOpenDialog` → 若选了文件夹 → `codeAnalysisService.analyze(uri)` → 成功发 `code_analysis_result`，失败发 `code_analysis_failed`。
- `submit_code_analysis` handler：`inputService.fromCodeAnalysis(result, notes)` → 镜像一条用户消息（`[代码分析] 已导入固件代码，扫描 N 个文件`，N 取 `result.scannedFiles`）→ `pipeline.runRequirementStage(request)`。
- 实例化 `CodeAnalysisService`。

## 11. 文件清单（5 新建 + 7 修改）

| 操作 | 文件 |
|------|------|
| 新建 | `src/extension/analyzers/arduinoAnalyzer.ts` |
| 新建 | `src/extension/analyzers/arduinoAnalyzer.test.ts` |
| 新建 | `src/webview/panel/components/CodeFolderPicker.tsx`（+ `.css`） |
| 新建 | `src/webview/panel/components/CodeAnalysisPreview.tsx`（+ `.css`） |
| 新建 | `src/extension/services/CodeAnalysisService.ts` |
| 修改 | `src/shared/types/input.types.ts`（CodeAnalysisResult 扩展 2 字段） |
| 修改 | `src/shared/types/messages.types.ts`（4 消息 + mode 'code'） |
| 修改 | `src/extension/services/InputService.ts`（fromCodeAnalysis + codeContextToText） |
| 修改 | `src/extension/prompts/requirementPrompt.ts`（SYSTEM_PROMPT 追加规则） |
| 修改 | `src/extension/activate.ts`（2 handler + 实例化 service） |
| 修改 | `src/webview/panel/components/InputModeToggle.tsx`（第三段 + mode 类型） |
| 修改 | `src/webview/panel/store/inputStore.ts` + `PanelApp.tsx`（code 模式渲染 + 消息处理） |

（CSS 文件随组件，计入「新建」组件项。）

## 12. 测试计划

- **`arduinoAnalyzer.test.ts`（核心，重点覆盖）** —— 纯函数，多份 Arduino 代码样本：
  - ESP32 WiFi sketch：检测 `WiFi.h` 库、`WiFi` 外设、`Serial` UART。
  - 传感器 sketch：`pinMode(2, OUTPUT)` + `digitalWrite` → 引脚 2 output；`analogRead(A0)` → A0 input；`#define DHT_PIN 4` + `pinMode(DHT_PIN, INPUT)` → 引脚 4 input。
  - I2C/SPI：`Wire.begin()` → I2C；`SPI.begin()` → SPI。
  - 模糊引用：`pinMode(SENSOR_PIN, INPUT)` 且无 `#define SENSOR_PIN` → 产出 `AmbiguousRef`。
  - 方向冲突合并、跨文件 symbolTable、系统头过滤、`#include` 去重。
  - `codeContextToText` 序列化格式。
- `CodeAnalysisService`（vscode 文件遍历）、`activate.ts` 接线 —— 纯逻辑已下沉，编排手动验证（对齐 §15.2，说明原因）。
- 回归：`npm run compile` + `npm test` 全绿 + `npx @vscode/vsce package`。

## 13. 错误处理 / 边界

| 情况 | 处理 |
|------|------|
| 用户取消文件夹选择 | no-op |
| 文件夹无 Arduino 文件 | `code_analysis_failed` → 预览区提示「未找到 Arduino 代码文件」 |
| 超文件数/体积上限 | 扫到上限即停，`truncated = true`，预览标注「仅扫描前 N 个文件」 |
| 单文件读失败 | 跳过续扫 |
| 引脚标识符无法解析 | 记 `GpioUsage`（pin=标识符）+ `AmbiguousRef`，预览展示 |
| 扫描结果全空（有文件但没提取到信号） | 仍可确认注入；prompt 中代码块为空时退化为普通需求分析 |

## 14. 验收对齐（`IMPLEMENTATION_PLAN.md` §10.4，锚定 Arduino）

| 验收项 | 覆盖 |
|--------|------|
| 选 ESP32 Arduino 文件夹 → 检测出 GPIO/库/外设 | ✅ arduinoAnalyzer |
| 检测到模糊引用时向用户提问确认 | ✅ AmbiguousRef → 预览展示 + openQuestions |
| 代码分析结果可预览，用户确认后注入管线 | ✅ CodeAnalysisPreview + submit_code_analysis |
| 纯代码输入也能生成完整 RequirementSpec | ✅ fromCodeAnalysis → runRequirementStage 全管线 |
| 支持 C、C++、Python 三种语言 | ⚠️ V1 仅 C/C++（Arduino）；Python 明确推迟（见 §1.2） |

## 15. 风险 / 不在本轮

| 风险 / 排除项 | 说明 / 缓解 |
|------|------|
| 正则扫描漏检非常规代码风格 | V1 边界即「轻量扫描」；漏检项落入 AmbiguousRef 或由用户在可编辑的 Requirements 中补；不追求完备 |
| 大代码库扫描慢/占内存 | 200 文件 / 2MB 上限 + truncated 标记 |
| 引脚宏值为表达式（如 `BASE+1`） | 不入 symbolTable → 归为 AmbiguousRef，交用户确认 |
| Python / MicroPython | 明确推迟，后续单独立项 |
| 交互式管线内问答 | 不做；模糊项走预览 + openQuestions |
| 深度静态分析（宏展开/调用图） | 不做；纯正则/模式 |
