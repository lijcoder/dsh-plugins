import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CompletionCollector, isTopLevel, renderApproval, renderNotification, shortenCwd, truncateUtf8, utf8Length } from '../src/notify.js'
import {
  assistantMessageEvent,
  injectedMessageEvent,
  subagent,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
  testConfig,
} from './fixtures.js'

const config = testConfig()

describe('CompletionCollector', () => {
  test('采集兜底标题、目录、状态、问题、输出与耗时（session/title 不再增量采集）', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-1', '/Users/lijie/work/ai/dsh-plugins')
    collector.note(session.id, turnStartEvent(1, 1_000))
    collector.note(session.id, titleEvent('修复登录超时'))
    collector.note(session.id, userMessageEvent('帮我把登录超时改大一点'))
    collector.note(session.id, assistantMessageEvent('已把超时改为 30s', 1_500))
    collector.note(session.id, turnEndEvent(1, 'completed', 134_000))

    const completion = collector.take(session)
    assert.ok(completion)
    assert.deepEqual(
      { ...completion, outcome: completion.outcome.kind },
      {
        sessionId: 'sess-1',
        // 喂进来的 session/title 事件已被忽略：标题由 session-title 的投影提供。
        title: '帮我把登录超时改大一点',
        cwd: '/Users/lijie/work/ai/dsh-plugins',
        outcome: 'completed',
        turn: 1,
        startedAt: 1_000,
        endedAt: 134_000,
        question: '帮我把登录超时改大一点',
        output: '已把超时改为 30s',
      },
    )
  })

  test('没有 session/title 时用首条人类消息兜底，注入的 context 消息不算', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-2')
    collector.note(session.id, injectedMessageEvent('AGENTS.md 内容'))
    collector.note(session.id, userMessageEvent(' 帮我看下\n  这个 bug  '))
    collector.note(session.id, turnEndEvent(1))
    const completion = collector.take(session)
    assert.equal(completion?.title, '帮我看下 这个 bug')
    // 注入的上下文不当问题，只有真正的人类输入才算。
    assert.equal(completion?.question, '帮我看下 这个 bug')
  })

  test('问题按回合切换：第二轮带自己的问题，不带上一个回合的', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-2b')
    collector.note(session.id, turnStartEvent(1, 1_000))
    collector.note(session.id, userMessageEvent('第一轮的问题', 1_100))
    collector.note(session.id, assistantMessageEvent('第一轮回复', 1_200))
    collector.note(session.id, turnEndEvent(1, 'completed', 1_300))
    assert.equal(collector.take(session)?.question, '第一轮的问题')

    collector.note(session.id, turnStartEvent(2, 2_000))
    collector.note(session.id, userMessageEvent('第二轮的问题', 2_100))
    collector.note(session.id, assistantMessageEvent('第二轮回复', 2_200, 2))
    collector.note(session.id, turnEndEvent(2, 'completed', 2_300))
    const second = collector.take(session)
    assert.equal(second?.question, '第二轮的问题')
    assert.equal(second?.output, '第二轮回复')
  })

  test('未知 reason 退化为 unknown，不抛错', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-3')
    collector.note(session.id, turnEndEvent(1, 'some-plugin-reason'))
    assert.equal(collector.take(session)?.outcome.kind, 'unknown')
  })

  test('没有结束过回合时不产出', () => {
    const collector = new CompletionCollector()
    collector.note('sess-4', turnStartEvent(1))
    assert.equal(collector.take(topLevel('sess-4')), undefined)
    assert.equal(collector.take(topLevel('never-seen')), undefined)
  })

  test('同一个回合只产出一次，下一个回合再次产出', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-5')
    collector.note(session.id, turnEndEvent(1, 'completed', 2_000))
    assert.ok(collector.take(session))
    assert.equal(collector.take(session), undefined)

    collector.note(session.id, turnStartEvent(2, 3_000))
    collector.note(session.id, assistantMessageEvent('第二轮输出', 3_500, 2))
    collector.note(session.id, turnEndEvent(2, 'error', 4_000))
    const second = collector.take(session)
    assert.equal(second?.turn, 2)
    assert.equal(second?.outcome.label, '执行失败')
    assert.equal(second?.output, '第二轮输出')
  })

  test('输出按回合重置：本轮没有文本就不带上一轮的内容', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-6')
    collector.note(session.id, turnStartEvent(1, 1_000))
    collector.note(session.id, assistantMessageEvent('第一轮输出', 1_500))
    collector.note(session.id, turnEndEvent(1, 'completed', 2_000))
    collector.take(session)

    collector.note(session.id, turnStartEvent(2, 3_000))
    collector.note(session.id, turnEndEvent(2, 'completed', 4_000))
    assert.equal(collector.take(session)?.output, undefined)
  })

  test('forget 后不再追踪', () => {
    const collector = new CompletionCollector()
    const session = topLevel('sess-7')
    collector.note(session.id, turnEndEvent(1))
    collector.forget(session.id)
    assert.equal(collector.take(session), undefined)
  })
})

describe('isTopLevel', () => {
  test('顶层为 true，subagent 与更深委派为 false', () => {
    assert.equal(isTopLevel(topLevel()), true)
    assert.equal(isTopLevel(subagent()), false)
    assert.equal(isTopLevel({ header: { delegationDepth: 2 } } as never), false)
  })
})

function completion(overrides: Partial<Parameters<typeof renderNotification>[0]> = {}) {
  return {
    sessionId: 'sess-abc',
    title: '修复登录超时',
    cwd: '/work/demo',
    outcome: { kind: 'completed', label: '成功完成', emoji: '✅' },
    turn: 2,
    startedAt: 1_000,
    endedAt: 134_000,
    question: '帮我把登录超时改大一点',
    output: '已把登录超时从 3s 调到 30s。',
    ...overrides,
  }
}

describe('renderNotification', () => {
  test('渲染标题、会话、状态、目录、Session、问题与回复', () => {
    const content = renderNotification(completion(), config)
    assert.match(content, /^## ✅ DSH 任务完成$/m)
    assert.match(content, /> \*\*会话\*\*：修复登录超时/)
    assert.match(content, /^> \*\*状态\*\*：成功完成$/m)
    assert.match(content, /> \*\*目录\*\*：`\/work\/demo`/)
    assert.match(content, /> \*\*回合\*\*：#2 · 耗时 2m13s · \d\d-\d\d \d\d:\d\d/)
    assert.match(content, /^> \*\*Session\*\*：`sess-abc`$/m)
    // 字段顺序固定：会话 → 状态 → 目录 → 回合 → Session
    const order = ['> **会话**：', '> **状态**：', '> **目录**：', '> **回合**：', '> **Session**：']
      .map((head) => content.split('\n').findIndex((line) => line.startsWith(head)))
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
    assert.ok(order.every((index) => index >= 0))
    assert.match(content, /\*\*问题\*\*\n帮我把登录超时改大一点/)
    assert.match(content, /\*\*回复\*\*\n已把登录超时从 3s 调到 30s。/)
  })

  test('不使用这条通道不支持的 <font> 标签', () => {
    assert.doesNotMatch(renderNotification(completion(), config), /<font/)
    assert.doesNotMatch(renderApproval({ sessionId: 'sess-1', toolName: 'bash' }, config), /<font/)
  })

  test('home 目录缩写成 ~', () => {
    assert.equal(shortenCwd('/Users/lijie/work/demo', '/Users/lijie'), '~/work/demo')
    assert.equal(shortenCwd('/Users/lijie', '/Users/lijie'), '~')
    assert.equal(shortenCwd('/opt/data', '/Users/lijie'), '/opt/data')
  })

  test('失败状态照常渲染；缺目录时不渲染目录行，标题缺失时给兜底文案', () => {
    const content = renderNotification(completion({
      outcome: { kind: 'error', label: '执行失败', emoji: '❌' },
      cwd: undefined,
      title: undefined,
    }), config)
    assert.match(content, /\*\*状态\*\*：执行失败/)
    assert.match(content, /（未命名）/)
    assert.doesNotMatch(content, /\*\*目录\*\*/)
  })

  test('问题/回复可分别关掉，空内容不出段落', () => {
    assert.doesNotMatch(renderNotification(completion(), testConfig({ includeQuestion: false })), /\*\*问题\*\*/)
    assert.doesNotMatch(renderNotification(completion({ question: undefined }), config), /\*\*问题\*\*/)
    assert.doesNotMatch(renderNotification(completion(), testConfig({ includeOutput: false })), /\*\*回复\*\*/)
    assert.doesNotMatch(renderNotification(completion({ output: '   ' }), config), /\*\*回复\*\*/)
    // 关了问题，回复照常在。
    assert.match(renderNotification(completion(), testConfig({ includeQuestion: false })), /\*\*回复\*\*/)
  })

  test('整条内容受 maxContentBytes 约束，超长输出被截断', () => {
    const long = renderNotification(completion({ output: '中'.repeat(2_000) }), config)
    assert.ok(utf8Length(long) <= 4_096)
    assert.match(long, /…$/)

    const tight = renderNotification(completion({ output: 'x'.repeat(5_000) }), testConfig({ maxContentBytes: 200 }))
    assert.ok(utf8Length(tight) <= 200)
  })
})

describe('renderApproval', () => {
  test('渲染授权标题、会话、目录、工具、Session，原因放到正文段落', () => {
    const content = renderApproval({
      sessionId: 'sess-abc',
      title: '修复登录超时',
      cwd: '/work/demo',
      toolName: 'bash',
      reason: '该命令需要你的确认',
    }, config)
    assert.match(content, /^## 🔐 DSH 需要授权$/m)
    assert.match(content, /> \*\*会话\*\*：修复登录超时/)
    assert.match(content, /> \*\*目录\*\*：`\/work\/demo`/)
    assert.match(content, /> \*\*工具\*\*：`bash`/)
    assert.match(content, /^> \*\*Session\*\*：`sess-abc`$/m)
    // 原因在引用块之外，作为正文段落。
    assert.doesNotMatch(content, /> \*\*原因\*\*/)
    assert.match(content, /\*\*原因\*\*\n该命令需要你的确认/)
    assert.ok(content.indexOf('**原因**') > content.indexOf('> **Session**'))
    assert.match(content, /等你的授权/)
  })

  test('没有原因/目录/标题时不渲染对应行，仍然受字节预算约束', () => {
    const content = renderApproval({ sessionId: 'sess-1', toolName: 'fs_write' }, config)
    assert.doesNotMatch(content, /\*\*原因\*\*|\*\*目录\*\*/)
    assert.match(content, /（未命名）/)
    assert.match(content, /等你的授权/)
    assert.ok(utf8Length(renderApproval({ sessionId: 'sess-1', toolName: 'bash' }, testConfig({ maxContentBytes: 120 }))) <= 120)
  })
})

describe('truncateUtf8', () => {
  test('不超预算时原样返回，预算非正时返回空串', () => {
    assert.equal(truncateUtf8('hello', 10), 'hello')
    assert.equal(truncateUtf8('hello', 0), '')
  })

  test('不切断多字节字符，结果永远在预算内', () => {
    const cut = truncateUtf8('中'.repeat(10), 10)
    assert.equal(cut, '中中…')
    assert.equal(cut.includes('\uFFFD'), false)
  })
})
