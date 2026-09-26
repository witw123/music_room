/**
 * 供应商上游并发闸门:超出上限的调用排队等待(FIFO)。
 * 目的不是限速(那是 RateLimiter 的职责),而是防止某个上游变慢时
 * 大量并发 socket 堆积在本进程内,并降低触发对方风控的概率。
 * 上限可用环境变量按供应商调整(如 NETEASE_MAX_CONCURRENCY)。
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly label: string
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.max <= 0) {
      return task();
    }
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) {
        this.active += 1;
        next();
      }
    }
  }

  get queuedCount() {
    return this.waiting.length;
  }

  get labelName() {
    return this.label;
  }
}
