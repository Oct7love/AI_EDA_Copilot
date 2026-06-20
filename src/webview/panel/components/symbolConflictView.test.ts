import { describe, it, expect } from 'vitest';
import { buildConflictRows } from './symbolConflictView';
import type { SymbolConflict } from '../../../shared/types';

describe('buildConflictRows', () => {
  it('returns [] for undefined input', () => {
    expect(buildConflictRows(undefined)).toEqual([]);
  });

  it('returns [] for empty array input', () => {
    expect(buildConflictRows([])).toEqual([]);
  });

  it('maps a conflict with 2 definitions into one row with both locations', () => {
    const conflicts: SymbolConflict[] = [
      {
        symbol: 'LED_PIN',
        conflictType: 'redefinition',
        definitions: [
          { file: 'main.ino', line: 12, value: '2' },
          { file: 'config.h', line: 5, value: '13' },
        ],
        question: 'LED_PIN 在两处定义为不同值，请确认实际引脚？',
      },
    ];

    const rows = buildConflictRows(conflicts);

    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('LED_PIN');
    expect(rows[0].kind).toBe('重复定义');
    expect(rows[0].locations).toEqual(['main.ino:12 = 2', 'config.h:5 = 13']);
    expect(rows[0].question).toBe('LED_PIN 在两处定义为不同值，请确认实际引脚？');
  });

  it('preserves file name, line number and value in each location string', () => {
    const conflicts: SymbolConflict[] = [
      {
        symbol: 'SDA_PIN',
        conflictType: 'redefinition',
        definitions: [{ file: 'src/pins.h', line: 21, value: 'A4' }],
        question: '?',
      },
    ];

    const rows = buildConflictRows(conflicts);

    expect(rows[0].locations[0]).toBe('src/pins.h:21 = A4');
  });

  it('maps multiple conflicts into multiple rows', () => {
    const conflicts: SymbolConflict[] = [
      {
        symbol: 'LED_PIN',
        conflictType: 'redefinition',
        definitions: [{ file: 'a.h', line: 1, value: '2' }],
        question: 'q1',
      },
      {
        symbol: 'BUTTON_PIN',
        conflictType: 'redefinition',
        definitions: [{ file: 'b.h', line: 3, value: '7' }],
        question: 'q2',
      },
    ];

    const rows = buildConflictRows(conflicts);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.symbol)).toEqual(['LED_PIN', 'BUTTON_PIN']);
  });
});
