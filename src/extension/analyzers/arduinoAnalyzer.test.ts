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
});
