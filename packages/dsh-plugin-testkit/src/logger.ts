import type { Context, Message } from '@deepseek-ai/cordis'

/**
 * 记录日志行的替身，两种用法：
 * 1. 手搓 Context 时直接当 `ctx.logger` 用（只需要 debug/info/warn/error 四个方法）；
 * 2. 真实 Context 上用 {@link captureLogs} 接在 logger exporter 上。
 */
export class LogRecorder {
  readonly lines: string[] = []

  debug(...args: unknown[]): void {
    this.push(args)
  }

  info(...args: unknown[]): void {
    this.push(args)
  }

  warn(...args: unknown[]): void {
    this.push(args)
  }

  error(...args: unknown[]): void {
    this.push(args)
  }

  /** 是否有一行日志包含该片段。 */
  has(needle: string): boolean {
    return this.lines.some((line) => line.includes(needle))
  }

  clear(): void {
    this.lines.length = 0
  }

  private push(args: unknown[]): void {
    this.lines.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '))
  }
}

/**
 * 把真实 Context 的日志导流进 recorder。
 *
 * cordis 的 `ctx.logger` 是内置服务，用 exporter 接日志比替换整个 logger 服务更贴近真实路径：
 * 被测插件仍旧走 `ctx.logger.info(...)`，只是最终落进 recorder 而不是控制台。
 *
 * @param ctx - 被测插件所在的 Context。
 * @param recorder - 复用已有 recorder；省略则新建。
 * @returns 传入或新建的 recorder。
 */
export function captureLogs(ctx: Context, recorder = new LogRecorder()): LogRecorder {
  ctx.logger.exporter({
    export: (message: Message) => {
      recorder.info(...message.args)
    },
  })
  return recorder
}
