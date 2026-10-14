/**
 * DeepSeek Harness 插件测试工具。
 *
 * 主张：插件的集成测试应该挂在**真实的 cordis Context** 上，而不是手搓的替身对象。
 * 手搓替身会绕过注入、effect 清理与事件分发，于是「少声明 inject」「忘了释放连接」
 * 这类缺陷只会在真机上才暴露。
 *
 * @module @lijcoder/dsh-plugin-testkit
 */

export { captureLogs, LogRecorder } from './logger.js'
export { createTestContext } from './context.js'
export type { TestContext } from './context.js'
export {
  assistantMessageEvent,
  event,
  fakeAgent,
  injectedMessageEvent,
  session,
  subagent,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
} from './session.js'
export type { FakeAgent } from './session.js'
export { emitAgentStatus, emitSessionEvent, requestApproval } from './events.js'
