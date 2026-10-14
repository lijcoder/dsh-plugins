import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import { captureLogs, LogRecorder } from './logger.js'

/** 一个可用的测试 Context：真实 cordis 实例 + 日志捕获 + 统一的释放。 */
export interface TestContext {
  readonly ctx: Context
  readonly logs: LogRecorder
  /**
   * 挂载插件并等待注入满足。
   *
   * 用真实 Context 而不是手搓对象，是为了让 `inject`、`ctx.effect` 清理、
   * 服务提供与事件分发都走真实实现——「插件少声明 inject，运行时才炸」这类
   * bug 在手搓 Context 上是看不见的。
   *
   * @param plugin - cordis 插件（`{ name, inject, apply }` 或 apply 函数）。
   * @param config - 传给插件的配置，交给插件自己的 Config schema 校验。
   * @returns 已激活的 fiber，可单独 dispose。
   */
  mount(plugin: Plugin, config?: unknown): Promise<Fiber>
  /** 用替身顶替一个服务，供被测插件 inject。必须在 mount 之前调用。 */
  provide(name: string, value: unknown): void
  /** 释放所有已挂载插件与根 fiber 上的 effect（provide / exporter）。 */
  dispose(): Promise<void>
}

/**
 * 建一个真实的 cordis Context。
 *
 * @returns 带日志捕获与释放能力的测试 Context。
 */
export function createTestContext(): TestContext {
  const ctx = new CordisContext()
  const logs = captureLogs(ctx)
  const fibers: Fiber[] = []

  return {
    ctx,
    logs,
    async mount(plugin, config) {
      const fiber = await ctx.plugin(plugin, config)
      fibers.push(fiber)
      return fiber
    },
    provide(name, value) {
      // cordis 的 provide 按服务名做静态收窄；测试里服务名是动态的，这里收回宽签名。
      const provide = ctx.provide as unknown as (name: string, value: unknown) => () => void
      provide(name, value)
    },
    async dispose() {
      for (const fiber of fibers.reverse()) await fiber.dispose()
      await ctx.fiber.dispose()
    },
  }
}
