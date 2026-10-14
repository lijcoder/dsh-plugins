/**
 * 跨包端到端测试：把四行（接缝 + 企微通道 + 通知 + 命令）挂到同一个**真实 cordis Context**
 * 上，对着本地 Mock 企微长连接服务端跑，断言用户真正看到的那些帧。
 *
 * 这是唯一能验证「几个包拼起来确实能工作」的地方：单包测试各自绿，不代表组合起来能跑通
 * ——行序、通道注册、inject 满足、渲染串起来，全靠这条测试。
 *
 * 为什么放在通道包里：Mock 服务端实现的是**企微协议**，它天然属于通道；跨包用例需要同时
 * 依赖通知与命令包，放在这里只多两个 devDependency，比为此单养一个组合包便宜。
 *
 * 全程不需要真实凭证，也不联外网。
 */
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { ImRegistry } from '@lijcoder/dsh-im'
import * as CommandsPlugin from '@lijcoder/dsh-im-commands'
import * as NotifyPlugin from '@lijcoder/dsh-notify'
import * as WecomPlugin from '../src/index.js'
import {
  assistantMessageEvent,
  createTestContext,
  emitAgentStatus,
  emitSessionEvent,
  fakeAgent,
  titleEvent,
  topLevel,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
} from '@lijcoder/dsh-plugin-testkit'
import { MockWecomServer, type MockServerInfo } from './mock-wecom.js'

const TARGET = 'mock-chatid'
/** 放在真实 home 下，好顺带验证路径缩写（`~`）这一路。 */
const CWD = join(homedir(), 'work/demo')

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

before(async () => {
  server = new MockWecomServer()
  info = await server.start()
})

after(async () => {
  await server.close()
})

/** node:test 的用例上下文，只用到 after 注册清理。 */
interface Cleanup {
  after(fn: () => Promise<void>): void
}

/**
 * 按「接缝 → 通道 → 功能」的顺序挂上四行（多包 add 时也是这个顺序）。
 *
 * 顺序有语义：命令功能在挂载时就要在通道上订阅消息，所以通道必须排在它前面。
 * 清理挂在 `t.after` 上——用例断言失败时也得跑到，否则长连接留着不放，
 * 后面的 `server.close()` 会一直等它。
 */
async function compose(t: Cleanup) {
  const h = createTestContext()
  t.after(() => h.dispose())

  const session = topLevel('sess-compose-1', CWD)
  h.provide('agents', { roots: () => [fakeAgent(session, 'idle')] })
  h.provide('sessionProjections', { stateOf: () => '修复登录超时' })

  const sinceSubscribe = server.received.length
  await h.mount(ImRegistry)
  await h.mount(WecomPlugin, { botId: 'mock-bot', secret: 'mock-secret', wsUrl: info.wsUrl })
  await h.mount(NotifyPlugin, { channel: 'wecom', target: TARGET })
  await h.mount(CommandsPlugin, { channel: 'wecom' })
  await server.waitFor((item) => item.cmd === 'aibot_subscribe', { timeoutMs: 5_000, since: sinceSubscribe })
  return { h, session }
}

describe('跨包：企微通道 + 通知 + / 命令', () => {
  test('回合结束 + agent 空闲 → 企微收到渲染好的 markdown 通知', async (t) => {
    const { h, session } = await compose(t)
    const since = server.received.length

    emitSessionEvent(h.ctx, session, turnStartEvent(1, 1_000))
    emitSessionEvent(h.ctx, session, titleEvent('修复登录超时'))
    emitSessionEvent(h.ctx, session, userMessageEvent('帮我把登录超时改大一点'))
    emitSessionEvent(h.ctx, session, assistantMessageEvent('已经改好了', 1_500))
    emitSessionEvent(h.ctx, session, turnEndEvent(1, 'completed', 2_000))
    emitAgentStatus(h.ctx, { session }, 'idle')

    const frame = await server.waitFor((item) => item.cmd === 'aibot_send_msg', { timeoutMs: 5_000, since })
    assert.equal(frame.body.chatid, TARGET)
    assert.equal(frame.body.msgtype, 'markdown')
    const sent = String(frame.body.markdown.content)
    assert.match(sent, /^## ✅ DSH 任务通知/)
    assert.match(sent, /> \*\*会话\*\*：修复登录超时/)
    assert.match(sent, /> \*\*状态\*\*：成功/)
    assert.match(sent, /> \*\*目录\*\*：`~\/work\/demo`/)
    assert.match(sent, /> \*\*Session\*\*：`sess-compose-1`/)
    assert.match(sent, /\*\*问题\*\*\n帮我把登录超时改大一点/)
    assert.match(sent, /\*\*回复\*\*\n已经改好了/)
    assert.doesNotMatch(sent, /<font/)
  })

  test('企微里发 /list → 被动回复按目录分组的会话清单', async (t) => {
    await compose(t)
    const since = server.received.length
    const reqId = server.sendTextMessage('/list')

    const frame = await server.waitFor(
      (item) => item.cmd === 'aibot_respond_msg' && item.body?.stream?.finish === true,
      { timeoutMs: 5_000, since },
    )

    // 被动回复沿用收到的 req_id（协议要求应答同一个回调）
    assert.equal(frame.headers.req_id, reqId)
    const sent = String(frame.body.stream.content)
    // 标题保持「会话（总数）」原样，括号后追加运行数（本例只有一个空闲会话）
    assert.match(sent, /^## 🖥 DSH 会话（1）· 🏃 0 个运行中/)
    // 企微支持标准 markdown 表格，所以走表格分支（不是降级形态）
    assert.match(sent, /\| 目录 \| 会话 \| 状态 \| sessionId \|/)
    assert.match(sent, /\| ~\/work\/demo \| 修复登录超时 \| 💤 空闲 \| sess-compose-1 \|/)
    assert.doesNotMatch(sent, /> 会话：/, '不该出现降级形态')
  })

  test('企微里发 /help → 列出命令；发普通聊天 → 不回复', async (t) => {
    await compose(t)

    const helpSince = server.received.length
    server.sendTextMessage('/help')
    const frame = await server.waitFor(
      (item) => item.cmd === 'aibot_respond_msg' && item.body?.stream?.finish === true,
      { timeoutMs: 5_000, since: helpSince },
    )
    const sent = String(frame.body.stream.content)
    assert.match(sent, /^## 🤖 DSH 命令/)
    assert.match(sent, /> \*\*\/list\*\*：列出当前活着的会话/)
    assert.match(sent, /> \*\*\/help\*\*：列出所有命令/)

    const chatSince = server.received.length
    server.sendTextMessage('在吗')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(
      server.received.slice(chatSince).some((item) => item.cmd === 'aibot_respond_msg'),
      false,
      '普通聊天不该被回复',
    )
  })

  test('dispose 之后长连接确实关掉了', async (t) => {
    const { h } = await compose(t)
    assert.equal(server.connected, true)
    await h.dispose()
    await eventually(() => !server.connected, '全部 dispose 后长连接应当已关闭')
  })
})
