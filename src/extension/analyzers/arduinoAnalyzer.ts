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
