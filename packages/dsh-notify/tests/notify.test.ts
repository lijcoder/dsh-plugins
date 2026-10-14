import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { ImRegistry, utf8Length, type ImDocument } from '@lijcoder/dsh-im'
import {
  assistantMessageEvent,
  createTestContext,
  emitAgentStatus,
  emitSessionEvent,
  requestApproval,
  subagent,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
  type TestContext,
} from '@lijcoder/dsh-plugin-testkit'
import * as NotifyPlugin from '../src/index.js'
import { isTopLevel, notificationDocument, approvalDocument } from '../src/notify.js'
import { fakeChannel, testConfig } from './fakes.js'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * 挂一整套真实的 Context：接缝 + 一个记账通道 + 被测的通知插件。
 *
 * 用真实 Context 而不是手搓替身，是为了让 `inject`、事件分发与 effect 清理都走真实实现
 * ——「插件少声明 inject」这类缺陷在手搓 Context 上是看不见的。
 */
async function harness(options: { config?: Parameters<typeof testConfig>[0]; title?: string } = {}) {
  const h = createTestContext()
  const { channel, sent, state } = fakeChannel()
  h.provide('agents', { roots: () => [] })
  h.provide('sessionProjections', { stateOf: () => options.title })
  await h.mount(ImRegistry)
  await h.mount({
    name: 'test-channel',
    inject: ['im'],
    apply(ctx: Context) {
      ctx.im.registerChannel('wecom', channel)
    },
  })
  await h.mount(NotifyPlugin, testConfig(options.config))
  return { h, sent, state }
}

/** 让一个回合完整跑一遍。 */
function finishTurn(h: TestContext, session: Session, kind = 'completed'): void {
  emitSessionEvent(h.ctx, session, turnStartEvent(1, 1_000))
  emitSessionEvent(h.ctx, session, titleEvent('修复登录超时'))
  emitSessionEvent(h.ctx, session, userMessageEvent('帮我把登录超时改大一点'))
  emitSessionEvent(h.ctx, session, assistantMessageEvent('好了', 1_500))
  emitSessionEvent(h.ctx, session, turnEndEvent(1, kind, 2_000))
}

/** 从文档里取某个键值行的值。 */
function fact(document: ImDocument, label: string): string | undefined {
  return document.facts?.find((item) => item.label === label)?.value
}

/** 从文档里取某段正文。 */
function section(document: ImDocument, title: string): string | undefined {
  return document.sections?.find((item) => item.title === title)?.body
}

describe('notificationDocument', () => {
  const completion = {
    sessionId: 'sess-1',
    title: '修复登录超时',
    cwd: '/work/demo',
    outcome: { kind: 'completed', label: '成功', emoji: '✅' },
    turn: 3,
    startedAt: 1_000,
    endedAt: 134_000,
    question: '帮我把登录超时改大一点',
    output: '已调到 30s。',
  }

  test('标题带状态图标；元信息是键值行，目录与 Session 标记为 code', () => {
    const document = notificationDocument(completion, testConfig())
    assert.equal(document.heading, '✅ DSH 任务完成')
    // 回合那行含本地时区渲染的时间戳，按形状断言，不写死时钟。
    assert.deepEqual(document.facts?.slice(0, 3), [
      { label: '会话', value: '修复登录超时' },
      { label: '状态', value: '成功' },
      { label: '目录', value: '/work/demo', code: true },
    ])
    assert.match(fact(document, '回合') ?? '', /^#3 · 耗时 2m13s · \d{2}-\d{2} \d{2}:\d{2}$/)
    assert.deepEqual(document.facts?.at(-1), { label: 'Session', value: 'sess-1', code: true })
    assert.deepEqual(document.sections, [
      { title: '问题', body: '帮我把登录超时改大一点' },
      { title: '回复', body: '已调到 30s。' },
    ])
  })

  test('缺目录时不产出目录行；标题缺失时给兜底文案', () => {
    const document = notificationDocument({ ...completion, cwd: undefined, title: undefined }, testConfig())
    assert.equal(fact(document, '目录'), undefined)
    assert.equal(fact(document, '会话'), '（未命名）')
  })

  test('问题/回复可分别关掉，空内容不出段落', () => {
    const off = notificationDocument(completion, testConfig({ includeQuestion: false, includeOutput: false }))
    assert.deepEqual(off.sections, [])

    const empty = notificationDocument({ ...completion, question: '  ', output: undefined }, testConfig())
    assert.deepEqual(empty.sections, [])
  })

  test('问题与回复按各自的字节预算截断', () => {
    const document = notificationDocument(
      { ...completion, output: '补充说明。'.repeat(500) },
      testConfig({ maxOutputBytes: 100 }),
    )
    const body = section(document, '回复') ?? ''
    assert.ok(utf8Length(body) <= 100, `实际 ${utf8Length(body)} 字节`)
    assert.match(body, /…$/)
  })
})

describe('approvalDocument', () => {
  const approval = {
    sessionId: 'sess-9',
    title: '修复登录超时',
    cwd: '/work/demo',
    toolName: 'bash',
    reason: '这条命令需要你确认',
  }

  test('工具与 Session 是 code 行，原因放正文段落，结尾提示回会话处理', () => {
    const document = approvalDocument(approval, testConfig())
    assert.equal(document.heading, '🔐 DSH 需要授权')
    assert.deepEqual(document.facts, [
      { label: '会话', value: '修复登录超时' },
      { label: '目录', value: '/work/demo', code: true },
      { label: '工具', value: 'bash', code: true },
      { label: 'Session', value: 'sess-9', code: true },
    ])
    assert.deepEqual(document.sections, [{ title: '原因', body: '这条命令需要你确认' }])
    assert.match(document.footer ?? '', /DSH 正在等你的授权/)
  })

  test('没有原因/目录时不产出对应节点', () => {
    const document = approvalDocument({ ...approval, cwd: undefined, reason: undefined }, testConfig())
    assert.equal(fact(document, '目录'), undefined)
    assert.deepEqual(document.sections, [])
  })
})

describe('isTopLevel', () => {
  test('顶层会话为真，subagent 子会话为假', () => {
    assert.equal(isTopLevel(topLevel()), true)
    assert.equal(isTopLevel(subagent()), false)
  })
})

describe('registerNotify', () => {
  test('agent 空闲时往配置的目标发一条；running 不发', async () => {
    const { h, sent } = await harness({ config: { target: 'chat-42' } })
    const session = topLevel('sess-1', '/work/demo')
    finishTurn(h, session)

    emitAgentStatus(h.ctx, { session }, 'running')
    await flush()
    assert.equal(sent.length, 0)

    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.target, 'chat-42')
    assert.equal(sent[0]?.document.heading, '✅ DSH 任务完成')
    assert.equal(fact(sent[0]!.document, '会话'), '帮我把登录超时改大一点')
    assert.equal(section(sent[0]!.document, '回复'), '好了')
    await h.dispose()
  })

  test('标题以投影为准：插件中途才挂载也能拿到真正的会话标题', async () => {
    const { h, sent } = await harness({ title: 'Greeting' })
    finishTurn(h, topLevel('sess-9'))
    emitAgentStatus(h.ctx, { session: topLevel('sess-9') }, 'idle')
    await flush()
    assert.equal(fact(sent[0]!.document, '会话'), 'Greeting')
    await h.dispose()
  })

  test('投影读不到标题时退回该会话的首条人类消息', async () => {
    const { h, sent } = await harness({ title: undefined })
    const session = topLevel('sess-10')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(fact(sent[0]!.document, '会话'), '帮我把登录超时改大一点')
    await h.dispose()
  })

  test('同一个回合重复空闲只发一次', async () => {
    const { h, sent } = await harness()
    const session = topLevel('sess-2')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 1)
    await h.dispose()
  })

  test('默认跳过 subagent 子会话，includeSubagents=true 时发送', async () => {
    const child = subagent()
    const skipped = await harness()
    finishTurn(skipped.h, child)
    emitAgentStatus(skipped.h.ctx, { session: child }, 'idle')
    await flush()
    assert.equal(skipped.sent.length, 0)
    await skipped.h.dispose()

    const included = await harness({ config: { includeSubagents: true } })
    finishTurn(included.h, child)
    emitAgentStatus(included.h.ctx, { session: child }, 'idle')
    await flush()
    assert.equal(included.sent.length, 1)
    await included.h.dispose()
  })

  test('onlyCompleted=true 时失败回合不发', async () => {
    const { h, sent } = await harness({ config: { onlyCompleted: true } })
    const session = topLevel('sess-3')
    finishTurn(h, session, 'error')
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 0)
    await h.dispose()
  })

  test('dryRun 只记日志不发送', async () => {
    const { h, sent } = await harness({ config: { dryRun: true } })
    const session = topLevel('sess-4')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 0)
    assert.ok(h.logs.has('dry-run'))
    await h.dispose()
  })

  test('发送失败只记 warn，不抛错', async () => {
    const { h, state } = await harness()
    state.failWith = new Error('errcode=93000 机器人 key 无效')
    const session = topLevel('sess-5')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.ok(h.logs.has('通知发送失败'))
    assert.ok(h.logs.has('93000'))
    await h.dispose()
  })

  test('通道名写错只记 warn，不让对话炸掉', async () => {
    const { h, sent } = await harness({ config: { channel: 'dingtalk' } })
    const session = topLevel('sess-6')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 0)
    assert.ok(h.logs.has('没有名为 "dingtalk" 的 IM 通道'))
    await h.dispose()
  })

  test('需要授权时发通知，并且照常把决策交给下游', async () => {
    const { h, sent } = await harness()
    const session = topLevel('sess-7', '/work/demo')
    emitSessionEvent(h.ctx, session, userMessageEvent('帮我把登录超时改大一点'))

    let downstream = 0
    const outcome = await requestApproval(
      h.ctx,
      { agent: { session }, toolName: 'bash', reason: '这条命令需要你确认' },
      async () => {
        downstream += 1
        return 'allowed-once'
      },
    )

    assert.equal(downstream, 1, '插件只旁观，必须继续调用 next()')
    assert.equal(outcome, 'allowed-once')
    await flush()
    assert.equal(sent.length, 1)
    const document = sent[0]!.document
    assert.equal(document.heading, '🔐 DSH 需要授权')
    assert.equal(fact(document, '会话'), '帮我把登录超时改大一点')
    assert.equal(fact(document, '工具'), 'bash')
    assert.equal(section(document, '原因'), '这条命令需要你确认')
    await h.dispose()
  })

  test('displayReason 优先中文；includeApprovals=false 时只放行不通知', async () => {
    const localized = await harness()
    await requestApproval(
      localized.h.ctx,
      {
        agent: { session: topLevel('sess-8') },
        toolName: 'bash',
        displayReason: { en: 'needs approval', zh: '需要确认' },
      },
      async () => 'rejected',
    )
    await flush()
    assert.equal(section(localized.sent[0]!.document, '原因'), '需要确认')
    await localized.h.dispose()

    const silent = await harness({ config: { includeApprovals: false } })
    let downstream = 0
    const outcome = await requestApproval(
      silent.h.ctx,
      { agent: { session: topLevel('sess-8') }, toolName: 'bash' },
      async () => {
        downstream += 1
        return 'allowed-once'
      },
    )
    await flush()
    assert.equal(downstream, 1)
    assert.equal(outcome, 'allowed-once')
    assert.equal(silent.sent.length, 0)
    await silent.h.dispose()
  })

  test('session/disposed 释放采集状态，之后空闲不再发送', async () => {
    const { h, sent } = await harness()
    const session = topLevel('sess-6')
    emitSessionEvent(h.ctx, session, turnEndEvent(1))
    h.ctx.emit('session/disposed', session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 0)
    await h.dispose()
  })
})
