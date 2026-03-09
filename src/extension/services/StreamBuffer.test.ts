/**
 * StreamBuffer 单元测试 — 批量缓冲、flush 时序、dispose 行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamBuffer } from './StreamBuffer';

describe('StreamBuffer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('在 flush 间隔内合并多个 chunk', () => {
    const onFlush = vi.fn();
    const buf = new StreamBuffer(onFlush, 100);

    buf.push('a');
    buf.push('b');
    buf.push('c');

    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('abc');
  });

  it('多轮 flush 独立触发', () => {
    const onFlush = vi.fn();
    const buf = new StreamBuffer(onFlush, 50);

    buf.push('x');
    vi.advanceTimersByTime(50);
    expect(onFlush).toHaveBeenCalledWith('x');

    buf.push('y');
    vi.advanceTimersByTime(50);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith('y');
  });

  it('空 buffer 不触发 flush 回调', () => {
    const onFlush = vi.fn();
    const buf = new StreamBuffer(onFlush, 100);

    buf.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('dispose 立即 flush 残留内容', () => {
    const onFlush = vi.fn();
    const buf = new StreamBuffer(onFlush, 100);

    buf.push('残留');
    buf.dispose();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('残留');
  });

  it('dispose 后 timer 不再触发', () => {
    const onFlush = vi.fn();
    const buf = new StreamBuffer(onFlush, 100);

    buf.push('data');
    buf.dispose();
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('默认 flush 间隔为 100ms', () => {
    const onFlush = vi.fn();
    const buf = new StreamBuffer(onFlush);

    buf.push('test');
    vi.advanceTimersByTime(99);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledOnce();
  });
});
