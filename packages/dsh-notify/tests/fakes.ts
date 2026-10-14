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

/** 一份合法的功能配置。 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    channel: 'wecom',
    target: 'chat-1',
    heading: 'DSH 任务完成',
    approvalHeading: 'DSH 需要授权',
    includeApprovals: true,
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
