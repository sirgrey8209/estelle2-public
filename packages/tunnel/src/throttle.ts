export class Throttle {
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSendTime = -Infinity;

  constructor(
    private intervalMs: number,
    private readonly onFlush: (messages: string[]) => void,
  ) {}

  setInterval(ms: number): void {
    this.intervalMs = ms;
  }

  getInterval(): number {
    return this.intervalMs;
  }

  push(message: string): void {
    const now = Date.now();
    const elapsed = now - this.lastSendTime;

    if (elapsed >= this.intervalMs) {
      // Enough time has passed — send immediately
      this.lastSendTime = now;
      this.onFlush([message]);
    } else {
      // Within interval — buffer
      this.buffer.push(message);
      if (!this.timer) {
        const remaining = this.intervalMs - elapsed;
        this.timer = setTimeout(() => this.flush(), remaining);
      }
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;

    const messages = this.buffer;
    this.buffer = [];
    this.lastSendTime = Date.now();
    this.onFlush(messages);
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      this.onFlush(this.buffer);
      this.buffer = [];
    }
  }
}
