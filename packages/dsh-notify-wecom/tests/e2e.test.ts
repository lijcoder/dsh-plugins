/**
 * 端到端测试：起一个 Mock 企微长连接服务端，跑**真实的插件代码**，断言它发出的每一帧。
 *
 * 两条路径都覆盖：
 * 1. 连接层——`WecomConnection` 直接对 Mock 说话，验证 SDK 协议帧（主动推送、被动回复）；
 * 2. 插件层——把整个插件挂到**真实 cordis Context** 上，走 inject / apply / provideWecom
 *    直到通知真的发出去。这条路径才是「少声明 inject」「effect 没释放连接」这类缺陷的
 *    守门人，手搓 Context 的单测看不见它们。
 *
 * 全程不需要真实凭证，也不联外网。
 *
 * 注意：Mock 只跟踪最新一条连接（忠实模拟企微「新连接顶掉旧连接」），
 * 因此两个 describe 不能同时持有连接——插件层的 before 会先停掉连接层那条。
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  assistantMessageEvent,
  createTestContext,
  emitAgentStatus,
  emitSessionEvent,
  LogRecorder,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
} from '@lijcoder/dsh-plugin-testkit'
import * as NotifyPlugin from '../src/index.js'
import { WecomCommandRouter } from '../src/commands.js'
import { renderNotification, utf8Length } from '../src/notify.js'
import { WecomConnection } from '../src/wecom.js'
import { testConfig } from './fakes.js'
import { MockWecomServer, type MockServerInfo } from './mock-wecom.js'

const TARGET = 'mock-chatid'
const logger = new LogRecorder()

const style = {
  heading: 'DSH 任务完成',
  includeQuestion: true,
  includeOutput: true,
  maxContentBytes: 4_096,
  maxQuestionBytes: 400,
  maxOutputBytes: 2_000,
}

/** 一份内容足够长的样例通知，用来顺带验证 4096 字节截断。 */
function renderSample(): string {
  return renderNotification({
    sessionId: 'sess-e2e-1',
    title: '修复登录超时',
    cwd: '/Users/lijie/work/ai/dsh-plugins',
    outcome: { kind: 'completed', label: '成功', emoji: '✅' },
    turn: 3,
    startedAt: 1_000,
    endedAt: 134_000,
    question: '帮我把登录超时改大一点',
    output: `已把登录超时从 3s 调到 30s。\n\n改动文件：\n- src/auth/timeout.ts\n\n${'补充说明。'.repeat(400)}`,
  }, style)
}

/** 一份能连上 Mock 的插件配置。 */
function mockConfig(info: MockServerInfo, overrides = {}): ReturnType<typeof testConfig> {
  return testConfig({
    wsUrl: info.wsUrl,
    target: TARGET,
    botId: 'mock-bot',
    secret: 'mock-secret',
    heartbeatInterval: 30_000,
    maxReconnectAttempts: 1,
    maxAuthFailureAttempts: 1,
    requestTimeout: 5_000,
    connectTimeoutMs: 5_000,
    ...overrides,
  })
}

/** 等一个条件成立，用于断言「最终状态」而不是「恰好此刻的状态」。 */
async function eventually(predicate: () => boolean, message: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(message)
}

let server: MockWecomServer
let info: MockServerInfo
let connection: WecomConnection

before(async () => {
  server = new MockWecomServer()
  info = await server.start()
  connection = new WecomConnection({
    botId: 'mock-bot',
    secret: 'mock-secret',
    wsUrl: info.wsUrl,
    heartbeatInterval: 30_000,
    reconnectInterval: 1_000,
    maxReconnectAttempts: 1,
    maxAuthFailureAttempts: 1,
    requestTimeout: 5_000,
    connectTimeoutMs: 5_000,
  }, logger)
  connection.start()
  await server.waitFor((item) => item.cmd === 'aibot_subscribe', { timeoutMs: 5_000 })

  // 命令路由：收到文本消息 -> 路由器 -> 被动回复（不需要另配目标会话）
  const router = new WecomCommandRouter()
  router.register({ name: 'ping', summary: '连通性探测', run: (args) => `## 🏓 pong\n> ${args || 'ok'}` })
  connection.onMessage((message) => {
    void router.handle(message, 4_096)
  })
})

after(async () => {
  await connection.stop()
  await server.close()
})

describe('连接层：WecomConnection × Mock 企微长连接', () => {
  test('sendMarkdown 发出 aibot_send_msg + markdown 载荷', async () => {
    const content = renderSample()
    assert.ok(utf8Length(content) <= 4_096, `内容必须在 4096 字节内，实际 ${utf8Length(content)}`)

    const since = server.received.length
    await connection.sendMarkdown(TARGET, content)

    const frame = await server.waitFor((item) => item.cmd === 'aibot_send_msg', { timeoutMs: 5_000, since })

    assert.equal(frame.body.chatid, TARGET)
    assert.equal(frame.body.msgtype, 'markdown')
    assert.equal(frame.headers.req_id.startsWith('aibot_send_msg'), true)
    const sent = String(frame.body.markdown.content)
    assert.match(sent, /## ✅ DSH 任务完成/)
    assert.match(sent, /\*\*会话\*\*：修复登录超时/)
    assert.match(sent, /\*\*目录\*\*：`~\/work\/ai\/dsh-plugins`/)
    assert.match(sent, /\*\*状态\*\*：成功/)
    assert.doesNotMatch(sent, /<font/)
    assert.match(sent, /\*\*问题\*\*\n帮我把登录超时改大一点/)
    assert.match(sent, /\*\*回复\*\*/)
    assert.ok(utf8Length(sent) <= 4_096)
  })

  test('收到 /ping 后用同一条连接被动回复', async () => {
    const since = server.received.length
    const reqId = server.sendTextMessage('/ping 来自测试')

    const frame = await server.waitFor(
      (item) => item.cmd === 'aibot_respond_msg' && item.body?.stream?.finish === true,
      { timeoutMs: 5_000, since },
    )

    // 被动回复沿用收到的 req_id（协议要求应答同一个回调）
    assert.equal(frame.headers.req_id, reqId)
    assert.match(String(frame.body.stream.content), /## 🏓 pong/)
    assert.match(String(frame.body.stream.content), /来自测试/)

    // 被动回复不影响同一条连接上的主动推送
    await connection.sendMarkdown(TARGET, '## 收尾\n> 主动推送仍然可用')
  })

  test('普通聊天不回复', async () => {
    const since = server.received.length
    server.sendTextMessage('在吗')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(server.received.slice(since).some((item) => item.cmd === 'aibot_respond_msg'), false)
  })

  test('复用同一条连接再发一条', async () => {
    const since = server.received.length
    await connection.sendMarkdown(TARGET, '## 第二条\n> 复用连接')
    const frame = await server.waitFor((item) => item.cmd === 'aibot_send_msg', { timeoutMs: 5_000, since })
    assert.equal(frame.body.markdown.content, '## 第二条\n> 复用连接')
  })
})

describe('插件层：真实 cordis Context 上跑整个插件', () => {
  before(async () => {
    // 释放掉连接层那条：Mock 只留最新连接，而插件的 provideWecom 会新建一条。
    await connection.stop()
  })

  test('挂载 -> 回合结束 -> agent 空闲 -> 通知真的发到企微', async () => {
    const h = createTestContext()
    const session = topLevel('sess-plugin-1', '/work/demo')

    // 插件 inject 的两个服务；少提供任何一个，挂载就会一直 PENDING。
    h.provide('agents', { roots: () => [] })
    h.provide('sessionProjections', { stateOf: () => '修复登录超时' })

    // 这里跑的是 src/index.ts 的 apply：inject 解析 + provideWecom + registerNotify + registerCommands
    const sinceSubscribe = server.received.length
    await h.mount(NotifyPlugin, mockConfig(info))
    await server.waitFor((item) => item.cmd === 'aibot_subscribe', { timeoutMs: 5_000, since: sinceSubscribe })

    const since = server.received.length
    emitSessionEvent(h.ctx, session, turnStartEvent(1, 1_000))
    emitSessionEvent(h.ctx, session, titleEvent('修复登录超时'))
    emitSessionEvent(h.ctx, session, userMessageEvent('帮我把登录超时改大一点'))
    emitSessionEvent(h.ctx, session, assistantMessageEvent('已经改好了', 1_500))
    emitSessionEvent(h.ctx, session, turnEndEvent(1, 'completed', 2_000))
    emitAgentStatus(h.ctx, { session }, 'idle')

    const frame = await server.waitFor((item) => item.cmd === 'aibot_send_msg', { timeoutMs: 5_000, since })
    assert.equal(frame.body.chatid, TARGET)
    const sent = String(frame.body.markdown.content)
    assert.match(sent, /\*\*会话\*\*：修复登录超时/)
    assert.match(sent, /\*\*状态\*\*：成功/)
    assert.match(sent, /已经改好了/)

    // dispose 必须把长连接一起收掉：这条断言守住 ctx.effect 的释放路径
    await h.dispose()
    await eventually(() => !server.connected, '插件 dispose 后长连接应当已关闭')
  })

  test('同一个回合重复空闲只发一次', async () => {
    const h = createTestContext()
    const session = topLevel('sess-plugin-2', '/work/demo')
    h.provide('agents', { roots: () => [] })
    h.provide('sessionProjections', { stateOf: () => undefined })

    const sinceSubscribe = server.received.length
    await h.mount(NotifyPlugin, mockConfig(info))
    await server.waitFor((item) => item.cmd === 'aibot_subscribe', { timeoutMs: 5_000, since: sinceSubscribe })

    const since = server.received.length
    emitSessionEvent(h.ctx, session, userMessageEvent('跑一下'))
    emitSessionEvent(h.ctx, session, assistantMessageEvent('好', 1_100))
    emitSessionEvent(h.ctx, session, turnEndEvent(1, 'completed', 1_200))
    emitAgentStatus(h.ctx, { session }, 'idle')
    emitAgentStatus(h.ctx, { session }, 'idle')

    await server.waitFor((item) => item.cmd === 'aibot_send_msg', { timeoutMs: 5_000, since })
    await new Promise((resolve) => setTimeout(resolve, 200))
    const pushes = server.received.slice(since).filter((item) => item.cmd === 'aibot_send_msg')
    assert.equal(pushes.length, 1)

    await h.dispose()
    await eventually(() => !server.connected, '插件 dispose 后长连接应当已关闭')
  })

  test('inject 少一个服务时插件保持 PENDING，不会带病激活', async () => {
    const h = createTestContext()
    // 只提供 agents，故意不给 sessionProjections。
    h.provide('agents', { roots: () => [] })

    const fiber = await h.mount(NotifyPlugin, mockConfig(info))
    assert.notEqual(fiber.state, 'active', '注入未满足时不应激活')

    await h.dispose()
  })
})
