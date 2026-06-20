/**
 * Arduino/ESP32 固件代码启发式扫描器 — 纯函数，无 vscode 依赖。
 * 提取库引用 / GPIO 使用 / 外设 / 模糊引用，供 CodeAnalysisService 编排调用。
 */
import type {
  GpioUsage,
  AmbiguousRef,
  CodeAnalysisResult,
  SymbolConflict,
  SymbolDefinition,
} from '@shared/types';

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

/**
 * 去掉块注释与行注释，避免误匹配注释里的示例代码。
 * 注意：不处理字符串字面量，// 出现在字符串中（如 URL）会被截断。
 * 对 GPIO/库提取无实际影响（API 调用与 #include 不出现在字符串内）。
 */
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
    /\bconst(?:expr)?\s+(?:int|uint\d+_t|byte|short|unsigned\s+int)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*|\d+)\s*;/g,
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

/**
 * 去掉注释但保留换行，用于在按行计算行号时保持位置对齐。
 * 块注释里的换行被保留为换行，注释内容替换为空格，避免误匹配且不破坏行号。
 */
function stripCommentsKeepLines(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 引脚常量定义的提取规则：#define 与 const 整型，捕获 标识符 + 值 */
const PIN_DEFINE_PATTERNS = [
  /#define\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*|\d+)/g,
  /\bconst(?:expr)?\s+(?:int|uint\d+_t|byte|short|unsigned\s+int)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*|\d+)\s*;/g,
];

/**
 * 跨文件扫描引脚常量定义，找出「同名但值不同」的冲突。
 * 仅收录值为引脚字面量（纯数字 / A0…）的定义，避免对表达式宏、别名宏误报。
 * 逐文件处理，按注释剥离后的文本（保留行号）匹配，记录 file + 1-based line + value。
 *
 * 规则：
 * - 相同值重复定义 → 不算冲突
 * - 仅定义一次 → 不算冲突
 * - 2+ 处定义出现 ≥2 个不同字面量值 → 记为冲突
 */
export function detectSymbolConflicts(files: SourceFile[]): SymbolConflict[] {
  // symbol → 全部定义出处（含重复值，用于去重判断与展示）
  const defs = new Map<string, SymbolDefinition[]>();

  for (const f of files) {
    const cleaned = stripCommentsKeepLines(f.content);
    for (const re of PIN_DEFINE_PATTERNS) {
      for (const m of cleaned.matchAll(re)) {
        const name = m[1];
        const value = m[2];
        if (!isPinLiteral(value)) continue; // 非引脚字面量不参与冲突判定
        const index = m.index ?? 0;
        // 1-based 行号：匹配位置前的换行数 + 1
        const line = countNewlines(cleaned, index) + 1;
        const list = defs.get(name) ?? [];
        list.push({ file: f.path, line, value });
        defs.set(name, list);
      }
    }
  }

  const conflicts: SymbolConflict[] = [];
  for (const [symbol, list] of defs) {
    const distinctValues = new Set(list.map((d) => d.value));
    if (distinctValues.size < 2) continue; // 单值（含相同值重复）→ 非冲突
    conflicts.push({
      symbol,
      definitions: list,
      conflictType: 'redefinition',
      question: `\`${symbol}\` 在多处被定义为不同的引脚值（${[...distinctValues].join(' / ')}）——应以哪个为准？`,
    });
  }
  return conflicts.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** 统计 text 在 [0, index) 区间内的换行数（用于推算行号） */
function countNewlines(text: string, index: number): number {
  let count = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

/** 提取 #include 库（去重、排序、过滤系统头） */
export function extractLibraries(code: string): string[] {
  const libs = new Set<string>();
  for (const m of code.matchAll(/#include\s*(?:<([^>]+)>|"([^"]+)")/g)) {
    const header = (m[1] ?? m[2] ?? '').trim();
    if (header && !SYSTEM_HEADERS.has(header.toLowerCase())) libs.add(header);
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

  for (const m of code.matchAll(new RegExp(`\\bpinMode\\(\\s*${PIN}\\s*,\\s*(\\w+)\\s*\\)`, 'g'))) {
    const mode = m[2].toUpperCase();
    if (mode === 'OUTPUT') record(m[1], 'output', `pinMode ${m[2]}`);
    else if (mode.startsWith('INPUT')) record(m[1], 'input', `pinMode ${m[2]}`);
  }

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

/**
 * 跨文件符号冲突 → AmbiguousRef，使其经现有报告路径流入 openQuestions（无需改 UI）。
 * 与 symbolConflicts 内容保持一致：reference=符号名，question 复用冲突问题。
 */
function conflictsToAmbiguous(conflicts: SymbolConflict[]): AmbiguousRef[] {
  return conflicts.map((c) => ({
    reference: c.symbol,
    possibleMeanings: c.definitions.map((d) => `${d.value}（${d.file}:${d.line}）`),
    question: c.question,
  }));
}

/** 主入口：合并所有文件做整体扫描 */
export function analyzeArduinoCode(files: SourceFile[]): ArduinoAnalysis {
  const merged = stripComments(files.map((f) => f.content).join('\n'));
  const symbols = buildSymbolTable(merged);
  const { gpios, ambiguous } = extractGpios(merged, symbols);
  // 跨文件引脚常量冲突（逐文件，带 file+line）——避免符号表 first-write-wins 静默丢值（EDA-7）
  const symbolConflicts = detectSymbolConflicts(files);
  const result: ArduinoAnalysis = {
    language: 'cpp',
    detectedGpios: gpios,
    detectedLibraries: extractLibraries(merged),
    detectedPeripherals: extractPeripherals(merged),
    // 同时附带冲突 AmbiguousRef，使现有 openQuestions 路径自动暴露
    ambiguousReferences: [...ambiguous, ...conflictsToAmbiguous(symbolConflicts)],
  };
  if (symbolConflicts.length > 0) {
    result.symbolConflicts = symbolConflicts;
  }
  return result;
}
