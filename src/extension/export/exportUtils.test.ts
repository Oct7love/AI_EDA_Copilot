/**
 * exportUtils 单元测试 — 文件名生成 + CSV 转义/公式注入防护
 */
import { describe, it, expect } from 'vitest';
import { csvEscape, generateExportFilename } from './exportUtils';

describe('csvEscape', () => {
  it('普通值原样返回', () => {
    expect(csvEscape('ESP32-WROOM')).toBe('ESP32-WROOM');
  });

  it('含逗号/引号/换行时加引号并转义内部引号', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('中和公式注入前缀 = + - @（加单引号守卫）', () => {
    expect(csvEscape('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvEscape('+1')).toBe("'+1");
    expect(csvEscape('-1')).toBe("'-1");
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('中和制表符/回车前缀', () => {
    expect(csvEscape('\tcmd')).toBe("'\tcmd");
    expect(csvEscape('\rcmd')).toBe("'\rcmd");
  });

  it('空值安全', () => {
    expect(csvEscape('')).toBe('');
  });
});

describe('generateExportFilename', () => {
  it('清洗掉路径分隔符等危险字符', () => {
    const name = generateExportFilename('../../etc/passwd', 'report', 'md');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toMatch(/-report\.md$/);
  });

  it('空 projectName 回退为 untitled', () => {
    expect(generateExportFilename('', 'bom', 'csv')).toMatch(/^untitled-/);
  });
});
