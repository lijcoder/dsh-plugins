import type { Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import type { ImCapabilities, ImChannel, ImDocument } from '@lijcoder/dsh-im'
import type { Config } from '../src/config.js'

/** 通道替身：记账 + 可注入失败。 */
export function fakeChannel() {
  const sent: Array<{ target: string; document: ImDocument }> = []
  const capabilities: ImCapabilities = {
    richText: true,
    tables: false,
    maxContentBytes: 4_096,
    proactive: true,
  }
  const state = { failWith: undefined as Error | undefined }
  const channel: ImChannel = {
    capabilities,
    async send(target, document) {
      if (state.failWith !== undefined) throw state.failWith
      sent.push({ target, document })
    },
    onMessage() {
      return () => {}
    },
  }
  return { channel, sent, state }
}

/**
 * 通知配置的**输入**形状。
 *
 * `target` 与两个字节预算在插件配置里是 volatile 引用，而用例给的是普通值：挂载时 cordis
 * 按 schema 解析会把它们包成引用，纯函数（`notificationDocument` / `approvalDocument`）
 * 要的也正是普通值。所以这三个字段在这里收宽——其余字段仍按 `Config` 检查。
 */
export type TestConfig = Omit<Config, 'target' | 'maxQuestionBytes' | 'maxOutputBytes'> & {
  target?: string
  maxQuestionBytes?: number
  maxOutputBytes?: number
}

/** 可写的 volatile 引用替身：插件只读它，「用户在页面上保存」由用例改值模拟。 */
export type MutableRef<T> = Volatile<T> & { set(next: T): void }

/** 造一个可写引用。 */
export function ref<T>(value: T): MutableRef<T> {
  let current = value
  return {
    get: () => current as VolatileSnapshot<T>,
    set: (next) => { current = next },
  }
}

/**
 * `testConfig()` 交出来的形状：volatile 字段都是普通值，两个预算因此**必有**
 * ——纯函数（`notificationDocument` / `approvalDocument`）要的正是普通数字。
 */
export type PlainConfig = TestConfig & { maxQuestionBytes: number; maxOutputBytes: number }

/** 一份合法的功能配置。 */
export function testConfig(overrides: Partial<TestConfig> = {}): PlainConfig {
  return {
    channel: 'wecom',
    target: 'chat-1',
    heading: 'DSH 任务完成',
    approvalHeading: 'DSH 需要授权',
    questionHeading: 'DSH 需要你回答',
    includeApprovals: true,
    includeQuestions: true,
    includeSubagents: false,
    onlyCompleted: false,
    includeQuestion: true,
    includeOutput: true,
    maxQuestionBytes: 400,
    maxOutputBytes: 2_000,
    dryRun: false,
    ...overrides,
  }
}

/**
 * 插件运行时看到的那份配置：volatile 字段是可写引用，并把两个预算的句柄交回给用例。
 * 不走 schema 解析的用例（直接调 `styleOf` / `registerNotify`）需要这个——挂载路径由
 * cordis 自己包引用，用 `testConfig()` 就够。
 */
export function volatileConfig(overrides: Partial<TestConfig> = {}): {
  config: Config
  maxQuestionBytes: MutableRef<number>
  maxOutputBytes: MutableRef<number>
} {
  const plain = testConfig(overrides)
  const maxQuestionBytes = ref(plain.maxQuestionBytes)
  const maxOutputBytes = ref(plain.maxOutputBytes)
  return {
    config: { ...plain, target: ref(plain.target), maxQuestionBytes, maxOutputBytes },
    maxQuestionBytes,
    maxOutputBytes,
  }
}
