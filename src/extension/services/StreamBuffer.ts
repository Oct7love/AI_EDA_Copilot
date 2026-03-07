/**
 * 100ms 批量缓冲器
 * 将高频流式 chunk 合并为低频批量推送，降低 UI 刷新开销
 */
export class StreamBuffer {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;
  private readonly onFlush: (content: string) => void;

  constructor(onFlush: (content: string) => void, flushIntervalMs = 100) {
    this.onFlush = onFlush;
    this.flushIntervalMs = flushIntervalMs;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const content = this.buffer;
      this.buffer = '';
      this.onFlush(content);
    }
  }

  dispose(): void {
    this.flush();
  }
}
