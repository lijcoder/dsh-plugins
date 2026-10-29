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
  requestUserQuestions,
  subagent,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
  type TestContext,
} from '@lijcoder/dsh-plugin-testkit'
import * as NotifyPlugin from '../src/index.js'
import { isTopLevel, notificationDocument, approvalDocument, questionDocument, styleOf } from '../src/notify.js'
import { fakeChannel, testConfig, volatileConfig } from './fakes.js'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * 挂一整套真实的 Context：接缝 + 一个记账通道 + 被测的通知插件。
 *
 * 用真实 Context 而不是手搓替身，是为了让 `inject`、事件分发与 effect 清理都走真实实现
 * ——「插件少声明 inject」这类缺陷在手搓 Context 上是看不见的。
 */
async function harness(options: {
  config?: Parameters<typeof testConfig>[0]
  title?: string
  /** 在通知插件挂载**之前**注册的监听器：用来复刻 dsh 宿主的注册顺序。 */
  beforeNotify?: (ctx: Context) => void
} = {}) {
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
  options.beforeNotify?.(h.ctx)
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

describe('questionDocument', () => {
  const question = {
    sessionId: 'sess-11',
    title: '排查构建失败',
    cwd: '/work/demo',
    questions: [{
      title: '问题',
      question: '先改哪个？',
      options: [{ label: 'A' }, { label: 'B', description: '更稳' }],
      multiSelect: false,
    }],
  }

  test('题干与选项各占行，选项说明用「：」连；结尾提示回会话处理', () => {
    const document = questionDocument(question, testConfig())
    assert.equal(document.heading, '❓ DSH 需要你回答')
    assert.deepEqual(document.facts, [
      { label: '会话', value: '排查构建失败' },
      { label: '目录', value: '/work/demo', code: true },
      { label: 'Session', value: 'sess-11', code: true },
    ])
    assert.deepEqual(document.sections, [{
      title: '问题',
      body: '先改哪个？\n选项：\n1. A\n2. B：更稳',
    }])
    assert.match(document.footer ?? '', /DSH 正在等你的回答/)
  })

  test('多选标注、补充说明与多问题编号', () => {
    const document = questionDocument({
      ...question,
      questions: [
        { title: '问题 1', question: '要跑测试吗？', options: [], multiSelect: false },
        { title: '问题 2', question: '跑哪些？', detail: '全量比较慢', options: [{ label: '单测' }], multiSelect: true },
      ],
    }, testConfig())
    assert.deepEqual(document.sections, [
      { title: '问题 1', body: '要跑测试吗？' },
      { title: '问题 2', body: '跑哪些？\n全量比较慢\n选项（可多选）：\n1. 单测' },
    ])
  })

  test('agentless 提问没有会话可报：facts 为空', () => {
    const document = questionDocument({
      questions: [{ title: '问题', question: '继续？', options: [], multiSelect: false }],
    }, testConfig())
    assert.deepEqual(document.facts, [])
    assert.equal(document.sections?.[0]?.title, '问题')
  })
})

describe('isTopLevel', () => {
  test('顶层会话为真，subagent 子会话为假', () => {
    assert.equal(isTopLevel(topLevel()), true)
    assert.equal(isTopLevel(subagent()), false)
  })
})
describe('styleOf', () => {
  test('两个字节预算每次现读引用：页面保存后的下一条通知就用新值', () => {
    const { config, maxQuestionBytes, maxOutputBytes } = volatileConfig()
    assert.equal(styleOf(config).maxQuestionBytes, 400)
    assert.equal(styleOf(config).maxOutputBytes, 2_000)

    maxQuestionBytes.set(1_000)
    maxOutputBytes.set(50)
    assert.equal(styleOf(config).maxQuestionBytes, 1_000)
    assert.equal(styleOf(config).maxOutputBytes, 50)
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

  test('目标还没配（插件页里空着）时不发，只记一条日志', async () => {
    const { h, sent } = await harness({ config: { target: undefined } })
    const session = topLevel('sess-no-target')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()
    assert.equal(sent.length, 0, '没目标就不该发，也不该报错')
    assert.ok(h.logs.has('通知目标未配置'))
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

  test('先注册的回答者直接返回决策时通知照发：瀑布链在第一个返回值处就停了', async () => {
    // 复刻 dsh 宿主的顺序：把 approval/request 转发给浏览器 UI 的那层监听器在启动早期
    // 就注册了，用户点「允许」后它带着结果返回、不再调 next()。挂在它后面的监听器永远
    // 不会执行——通知必须抢在链首观战，不能靠挂载顺序碰运气。
    let asked = 0
    const { h, sent } = await harness({
      beforeNotify(ctx) {
        ctx.on('approval/request', async () => {
          asked += 1
          return 'allowed-once' as const
        })
      },
    })

    const outcome = await requestApproval(
      h.ctx,
      { agent: { session: topLevel('sess-order') }, toolName: 'bash', reason: '这条命令需要你确认' },
      async () => 'unavailable',
    )
    await flush()

    assert.equal(asked, 1)
    assert.equal(outcome, 'allowed-once', '回答者仍要拿到决策权')
    assert.equal(sent.length, 1, '回答者先返回值时通知不能被吞掉')
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

  test('需要你回答时发通知，并且照常把回答交给下游', async () => {
    const { h, sent } = await harness()
    const session = topLevel('sess-12', '/work/demo')
    emitSessionEvent(h.ctx, session, userMessageEvent('帮我选个方案'))

    let downstream = 0
    const answer = await requestUserQuestions(
      h.ctx,
      {
        agent: { session },
        questions: [{
          id: 'q1',
          question: '先改哪个？',
          options: [{ label: 'A' }, { label: 'B', description: '更稳' }],
        }],
      },
      async () => {
        downstream += 1
        return { answers: [{ id: 'q1', selected: ['A'] }] }
      },
    )

    assert.equal(downstream, 1, '插件只旁观，必须继续调用 next()')
    assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['A'] }] })
    await flush()
    assert.equal(sent.length, 1)
    const document = sent[0]!.document
    assert.equal(document.heading, '❓ DSH 需要你回答')
    assert.equal(fact(document, '会话'), '帮我选个方案')
    assert.equal(section(document, '问题'), '先改哪个？\n选项：\n1. A\n2. B：更稳')
    await h.dispose()
  })

  test('网页回答者先注册并直接作答时通知照发：瀑布链同样在第一个返回值处停', async () => {
    let asked = 0
    const { h, sent } = await harness({
      beforeNotify(ctx) {
        ctx.on('user-questions/request', async () => {
          asked += 1
          return { answers: [{ id: 'q1', selected: ['A'] }] }
        })
      },
    })

    const answer = await requestUserQuestions(
      h.ctx,
      { questions: [{ id: 'q1', question: '先改哪个？', options: [{ label: 'A' }] }] },
      async () => ({ answers: [] }),
    )
    await flush()

    assert.equal(asked, 1)
    assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['A'] }] })
    assert.equal(sent.length, 1, '回答者先返回值时通知不能被吞掉')
    await h.dispose()
  })

  test('多个问题按「问题 N」编号，header 优先作小标题；多选与选项照原样', async () => {
    const { h, sent } = await harness()
    await requestUserQuestions(
      h.ctx,
      {
        agent: { session: topLevel('sess-14') },
        questions: [
          { id: 'q1', question: '先改哪个方案？', header: '方案', options: [{ label: 'A' }] },
          { id: 'q2', question: '跑哪些测试？', options: [{ label: '单测' }], multiSelect: true },
        ],
      },
      async () => ({ answers: [] }),
    )
    await flush()

    const sections = sent[0]!.document.sections ?? []
    assert.deepEqual(sections.map((item) => item.title), ['方案', '问题 2'])
    assert.equal(sections[1]?.body, '跑哪些测试？\n选项（可多选）：\n1. 单测')
    await h.dispose()
  })

  test('includeQuestions=false 时只放行不通知', async () => {
    const { h, sent } = await harness({ config: { includeQuestions: false } })
    let downstream = 0
    const answer = await requestUserQuestions(
      h.ctx,
      { agent: { session: topLevel('sess-13') }, questions: [{ id: 'q1', question: '继续？', options: [] }] },
      async () => {
        downstream += 1
        return { answers: [] }
      },
    )
    await flush()

    assert.equal(downstream, 1)
    assert.deepEqual(answer, { answers: [] })
    assert.equal(sent.length, 0)
    await h.dispose()
  })

  test('字节预算走配置页填进来的值：挂载时按 schema 解析出的预算就是发出正文的上限', async () => {
    const { h, sent } = await harness({ config: { maxQuestionBytes: 30, maxOutputBytes: 50 } })
    const session = topLevel('sess-budget')
    finishTurn(h, session)
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()

    const document = sent[0]!.document
    const question = section(document, '问题') ?? ''
    const output = section(document, '回复') ?? ''
    assert.ok(utf8Length(question) <= 30, `问题段实际 ${utf8Length(question)} 字节`)
    assert.ok(utf8Length(output) <= 50, `回复段实际 ${utf8Length(output)} 字节`)
    await h.dispose()
  })

  test('问题正文只受预算约束：超过 500 字也不在采集阶段被预截断', async () => {
    const { h, sent } = await harness({ config: { maxQuestionBytes: 10_000, maxOutputBytes: 10_000 } })
    const session = topLevel('sess-long-question')
    const question = `${'长'.repeat(600)}尾巴`

    emitSessionEvent(h.ctx, session, turnStartEvent(1, 1_000))
    emitSessionEvent(h.ctx, session, userMessageEvent(question))
    emitSessionEvent(h.ctx, session, turnEndEvent(1, 'completed', 2_000))
    emitAgentStatus(h.ctx, { session }, 'idle')
    await flush()

    const body = section(sent[0]!.document, '问题') ?? ''
    assert.equal(body, question, '预算够大时正文该一字不少')
    assert.ok(utf8Length(body) > 1_500, `实际 ${utf8Length(body)} 字节`)
    await h.dispose()
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
