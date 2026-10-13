import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { registerNotify } from '../src/notify.js'
import {
  assistantMessageEvent,
  fakeContext,
  FakeWecom,
  subagent,
  testConfig,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
} from './fixtures.js'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function build(config = testConfig(), projectedTitle?: string | null) {
  const fake = fakeContext({ wecom: new FakeWecom(), titleOf: () => projectedTitle })
  registerNotify(fake.ctx, config)
  return fake
}

/** 让一个回合完整跑一遍。 */
function finishTurn(
  handlers: Map<string, (...args: any[]) => unknown>,
  session = topLevel('sess-1'),
  kind = 'completed',
): void {
  const sessionEvent = handlers.get('session/event')
  assert.ok(sessionEvent)
  sessionEvent(session, turnStartEvent(1, 1_000))
  sessionEvent(session, titleEvent('修复登录超时'))
  sessionEvent(session, userMessageEvent('帮我把登录超时改大一点'))
  sessionEvent(session, assistantMessageEvent('好了', 1_500))
  sessionEvent(session, turnEndEvent(1, kind, 2_000))
}

function fireStatus(handlers: Map<string, (...args: any[]) => unknown>, session: unknown, status: string): void {
  const handler = handlers.get('agent/status')
  assert.ok(handler)
  handler({ agent: { session }, status })
}

describe('registerNotify', () => {
  test('订阅会话事件、agent 状态与授权请求', () => {
    const { handlers } = build()
    assert.deepEqual(
      [...handlers.keys()].sort(),
      ['agent/status', 'approval/request', 'session/disposed', 'session/event'],
    )
  })

  test('agent 空闲时往配置的目标发一条通知；running 不发', async () => {
    const { handlers, wecom } = build(testConfig({ target: 'chat-42' }))
    const session = topLevel('sess-1', '/work/demo')
    finishTurn(handlers, session)

    fireStatus(handlers, session, 'running')
    await flush()
    assert.equal(wecom.sent.length, 0)

    fireStatus(handlers, session, 'idle')
    await flush()
    assert.equal(wecom.sent.length, 1)
    assert.equal(wecom.sent[0]?.chatId, 'chat-42')
    const content = wecom.sent[0]?.content ?? ''
    assert.match(content, /\*\*会话\*\*：帮我把登录超时改大一点/)
    assert.match(content, /\/work\/demo/)
    assert.match(content, /\*\*状态\*\*：成功/)
    assert.match(content, /\*\*问题\*\*\n帮我把登录超时改大一点/)
    assert.match(content, /\*\*回复\*\*\n好了/)
  })

  test('标题以投影为准：插件中途才挂载也能拿到真正的会话标题', async () => {
    const { handlers, wecom } = build(testConfig(), 'Greeting')
    const session = topLevel('sess-9')
    finishTurn(handlers, session)          // 问题仍是本轮的「帮我把登录超时改大一点」
    fireStatus(handlers, session, 'idle')
    await flush()

    const content = wecom.sent[0]?.content ?? ''
    assert.match(content, /\*\*会话\*\*：Greeting/)
    assert.doesNotMatch(content, /\*\*会话\*\*：帮我把登录超时改大一点/)
  })

  test('投影读不到标题时退回该会话的首条人类消息', async () => {
    const { handlers, wecom } = build(testConfig(), undefined)
    const session = topLevel('sess-10')
    finishTurn(handlers, session)
    fireStatus(handlers, session, 'idle')
    await flush()
    assert.match(wecom.sent[0]?.content ?? '', /\*\*会话\*\*：帮我把登录超时改大一点/)
  })

  test('同一个回合重复空闲只发一次', async () => {
    const { handlers, wecom } = build()
    const session = topLevel('sess-2')
    finishTurn(handlers, session)
    fireStatus(handlers, session, 'idle')
    fireStatus(handlers, session, 'idle')
    await flush()
    assert.equal(wecom.sent.length, 1)
  })

  test('默认跳过 subagent 子会话，includeSubagents=true 时发送', async () => {
    const skipped = build()
    const child = subagent()
    finishTurn(skipped.handlers, child)
    fireStatus(skipped.handlers, child, 'idle')
    await flush()
    assert.equal(skipped.wecom.sent.length, 0)

    const included = build(testConfig({ includeSubagents: true }))
    finishTurn(included.handlers, child)
    fireStatus(included.handlers, child, 'idle')
    await flush()
    assert.equal(included.wecom.sent.length, 1)
  })

  test('onlyCompleted=true 时失败回合不发', async () => {
    const { handlers, wecom } = build(testConfig({ onlyCompleted: true }))
    const session = topLevel('sess-3')
    finishTurn(handlers, session, 'error')
    fireStatus(handlers, session, 'idle')
    await flush()
    assert.equal(wecom.sent.length, 0)
  })

  test('dryRun 只记日志不发送', async () => {
    const { handlers, wecom, logger } = build(testConfig({ dryRun: true }))
    const session = topLevel('sess-4')
    finishTurn(handlers, session)
    fireStatus(handlers, session, 'idle')
    await flush()
    assert.equal(wecom.sent.length, 0)
    assert.ok(logger.has('dry-run'))
  })

  test('发送失败只记 warn，不抛错', async () => {
    const { handlers, wecom, logger } = build()
    wecom.failWith = new Error('errcode=93000 机器人 key 无效')
    const session = topLevel('sess-5')
    finishTurn(handlers, session)
    fireStatus(handlers, session, 'idle')
    await flush()
    assert.ok(logger.has('通知发送失败'))
    assert.ok(logger.has('93000'))
  })

  test('需要授权时发通知，并且照常把决策交给下游', async () => {
    const { handlers, wecom } = build()
    const session = topLevel('sess-7', '/work/demo')
    const sessionEvent = handlers.get('session/event')
    assert.ok(sessionEvent)
    sessionEvent(session, userMessageEvent('帮我把登录超时改大一点'))

    let downstream = 0
    const approval = handlers.get('approval/request')
    assert.ok(approval)
    const outcome = await approval(
      {
        agent: { session },
        toolName: 'bash',
        reason: '这条命令需要你确认',
      },
      async () => {
        downstream += 1
        return 'allowed-once'
      },
    )

    assert.equal(downstream, 1)
    assert.equal(outcome, 'allowed-once')
    await flush()
    assert.equal(wecom.sent.length, 1)
    const content = wecom.sent[0]?.content ?? ''
    assert.match(content, /需要授权/)
    assert.match(content, /\*\*会话\*\*：帮我把登录超时改大一点/)
    assert.match(content, /\*\*工具\*\*：`bash`/)
    assert.match(content, /这条命令需要你确认/)
  })

  test('displayReason 优先中文；includeApprovals=false 时只放行不通知', async () => {
    const localized = build()
    const session = topLevel('sess-8')
    const localizedApproval = localized.handlers.get('approval/request')
    assert.ok(localizedApproval)
    await localizedApproval(
      { agent: { session }, toolName: 'bash', displayReason: { en: 'needs approval', zh: '需要确认' } },
      async () => 'rejected',
    )
    await flush()
    assert.match(localized.wecom.sent[0]?.content ?? '', /需要确认/)

    const silent = build(testConfig({ includeApprovals: false }))
    let downstream = 0
    const silentApproval = silent.handlers.get('approval/request')
    assert.ok(silentApproval)
    const outcome = await silentApproval(
      { agent: { session }, toolName: 'bash' },
      async () => {
        downstream += 1
        return 'allowed-once'
      },
    )
    await flush()
    assert.equal(downstream, 1)
    assert.equal(outcome, 'allowed-once')
    assert.equal(silent.wecom.sent.length, 0)
  })

  test('session/disposed 释放采集状态，之后空闲不再发送', async () => {
    const { handlers, wecom } = build()
    const session = topLevel('sess-6')
    const sessionEvent = handlers.get('session/event')
    const disposed = handlers.get('session/disposed')
    assert.ok(sessionEvent && disposed)
    sessionEvent(session, turnEndEvent(1))
    disposed(session)
    fireStatus(handlers, session, 'idle')
    await flush()
    assert.equal(wecom.sent.length, 0)
  })
})
