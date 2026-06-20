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
  detectSymbolConflicts,
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
  it('收录 const uint16_t / unsigned int 引脚', () => {
    expect(buildSymbolTable('const uint16_t PWM = 9;').get('PWM')).toBe('9');
    expect(buildSymbolTable('const unsigned int RELAY = 7;').get('RELAY')).toBe('7');
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

describe('detectSymbolConflicts', () => {
  it('两文件同名 #define 不同值 → 一个冲突，含双方 file+line', () => {
    const a = file('#define LED_PIN 2', 'a.h');
    const b = file('\n#define LED_PIN 13', 'b.h');
    const conflicts = detectSymbolConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.symbol).toBe('LED_PIN');
    expect(c.conflictType).toBe('redefinition');
    expect(c.definitions).toHaveLength(2);
    // file 名出现
    const fileSet = new Set(c.definitions.map((d) => d.file));
    expect(fileSet.has('a.h')).toBe(true);
    expect(fileSet.has('b.h')).toBe(true);
    // 行号：a.h 第1行，b.h 第2行（前置换行）
    const aDef = c.definitions.find((d) => d.file === 'a.h')!;
    const bDef = c.definitions.find((d) => d.file === 'b.h')!;
    expect(aDef.line).toBe(1);
    expect(aDef.value).toBe('2');
    expect(bDef.line).toBe(2);
    expect(bDef.value).toBe('13');
  });

  it('两文件同名 #define 相同值 → 无冲突', () => {
    const a = file('#define LED_PIN 2', 'a.h');
    const b = file('#define LED_PIN 2', 'b.h');
    expect(detectSymbolConflicts([a, b])).toHaveLength(0);
  });

  it('两文件同名 const int 引脚不同值 → 冲突', () => {
    const a = file('const int MOTOR = 5;', 'motor_a.h');
    const b = file('const int MOTOR = 9;', 'motor_b.h');
    const conflicts = detectSymbolConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].symbol).toBe('MOTOR');
    expect(new Set(conflicts[0].definitions.map((d) => d.value))).toEqual(new Set(['5', '9']));
  });

  it('单处定义 → 无冲突', () => {
    expect(detectSymbolConflicts([file('#define LED_PIN 2', 'a.h')])).toHaveLength(0);
  });

  it('注释中的重定义不被误检为冲突', () => {
    const a = file('#define LED_PIN 2', 'a.h');
    const b = file('// #define LED_PIN 13\n#define OTHER 7', 'b.h');
    expect(detectSymbolConflicts([a, b])).toHaveLength(0);
  });

  it('非引脚字面量值（表达式）不参与冲突判定', () => {
    const a = file('#define GAIN (1 + 2)', 'a.h');
    const b = file('#define GAIN (3 + 4)', 'b.h');
    expect(detectSymbolConflicts([a, b])).toHaveLength(0);
  });

  it('多行文件中行号按出现位置计算', () => {
    const a = file('line1\nline2\n#define PIN 4', 'a.h');
    const b = file('#define PIN 5', 'b.h');
    const conflicts = detectSymbolConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    const aDef = conflicts[0].definitions.find((d) => d.file === 'a.h')!;
    expect(aDef.line).toBe(3);
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
    expect(pins).toContain('2');
    expect(pins).toContain('4');
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

  it('正常单文件项目：零冲突，检测不受影响', () => {
    const code = `
      #include <WiFi.h>
      #define LED 2
      void setup() { pinMode(LED, OUTPUT); }`;
    const r = analyzeArduinoCode([file(code)]);
    // 无冲突时不附带 symbolConflicts 字段
    expect(r.symbolConflicts).toBeUndefined();
    expect(r.detectedGpios.map((g) => g.pin)).toContain('2');
    expect(r.detectedLibraries).toEqual(['WiFi.h']);
    expect(r.ambiguousReferences).toHaveLength(0);
  });

  it('跨文件冲突：structured symbolConflicts + AmbiguousRef 同时出现', () => {
    const a = file('#define LED_PIN 2', 'a.h');
    const b = file('#define LED_PIN 13\nvoid loop(){}', 'b.h');
    const r = analyzeArduinoCode([a, b]);
    // 结构化冲突
    expect(r.symbolConflicts).toBeDefined();
    expect(r.symbolConflicts).toHaveLength(1);
    expect(r.symbolConflicts![0].symbol).toBe('LED_PIN');
    expect(r.symbolConflicts![0].definitions).toHaveLength(2);
    // 同一冲突也以 AmbiguousRef 形式出现（流入 openQuestions）
    const ref = r.ambiguousReferences.find((x) => x.reference === 'LED_PIN');
    expect(ref).toBeDefined();
    expect(ref!.question).toBe(r.symbolConflicts![0].question);
    // possibleMeanings 含 file 名
    expect(ref!.possibleMeanings.some((m) => m.includes('a.h'))).toBe(true);
    expect(ref!.possibleMeanings.some((m) => m.includes('b.h'))).toBe(true);
  });
});
