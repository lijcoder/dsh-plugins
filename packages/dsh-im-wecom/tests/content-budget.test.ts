/**
 * 字节预算（`maxContentBytes`）的集成测试。
 *
 * 它是 volatile 字段——配置页里改完 loader 只就地更新引用、**不重挂**插件，所以通道得自己
 * 把三件事做对，而这三件都不会在单测里自己暴露：
 *   1. 注册给 `ctx.im` 的那份 `capabilities` 要跟着引用刷新（消费方读的是同一份引用，
 *      快照一次就会停在上一个值）；
 *   2. 渲染时按当前值截断整条消息；
 *   3. 改预算**不**重连——重连是凭证才需要的动作，无谓重连会踢掉正在用的那条长连接。
 *
 * 直接测 `provideWecomChannel`（生命周期的的主人）：这里要的是「同一个引用被换值」，
 * 那正是 loader 在 `loader/volatile-update` 前后干的事。
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type { Context, Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import { ImRegistry, utf8Length, type ImDocument } from '@lijcoder/dsh-im'
import { createTestContext } from '@lijcoder/dsh-plugin-testkit'
import type { Config } from '../src/config.js'
import { provideWecomChannel, WECOM } from '../src/channel.js'
import { MockWecomServer, type MockServerInfo } from './mock-wecom.js'

let server: MockWecomServer
let info: MockServerInfo

before(async () => {
  server = new MockWecomServer()
  info = await server.start()
})

after(async () => {
  await server.close()
})

/** 可写的 volatile 引用替身：插件只读它，换值由用例做（loader 也是这么换的）。 */
function ref<T>(value: T): Volatile<T> & { set(next: T): void } {
  let current = value
  return {
    get: () => current as VolatileSnapshot<T>,
    set: (next) => { current = next },
  }
}

/** 一份凭证齐全的配置，只有预算是可换的引用。 */
function config(maxContentBytes: Volatile<number>): Config {
  return {
    botId: ref('mock-bot'),
    secret: ref('mock-secret'),
    wsUrl: info.wsUrl,
    heartbeatInterval: 30_000,
    reconnectInterval: 1_000,
    maxReconnectAttempts: 10,
    maxAuthFailureAttempts: 5,
    requestTimeout: 10_000,
    connectTimeoutMs: 15_000,
    maxContentBytes,
  }
}

/** 一条远超任何预算的文档：只要没截断就一定会被看出来。 */
const LONG: ImDocument = {
  heading: '✅ 长正文',
  sections: [{ title: '回复', body: '补'.repeat(500) }],
}

describe('maxContentBytes 是 volatile 的渲染参数', () => {
  test('在配置页改完：capabilities 与发出的内容一起变，且不重连', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const maxContentBytes = ref(20_480)
    const fiber = await h.mount({
      name: 'wecom-under-test',
      inject: ['im'],
      apply(ctx: Context) {
        provideWecomChannel(ctx, config(maxContentBytes))
      },
    })
    await server.waitFor((frame) => frame.cmd === 'aibot_subscribe', { timeoutMs: 5_000 })

    const subscribes = server.received.filter((frame) => frame.cmd === 'aibot_subscribe').length
    assert.equal(h.ctx.im.channel(WECOM).capabilities.maxContentBytes, 20_480)

    // loader 更新 volatile 引用之后就发这个事件——插件只能从这里知道「用户在页面上保存了」。
    maxContentBytes.set(120)
    fiber.ctx.emit('loader/volatile-update', [['maxContentBytes']])

    assert.equal(
      h.ctx.im.channel(WECOM).capabilities.maxContentBytes,
      120,
      '注册表里那份能力声明要跟着引用走，不能停在挂载时的值',
    )

    const since = server.received.length
    await h.ctx.im.channel(WECOM).send('mock-chatid', LONG)
    const frame = await server.waitFor((item) => item.cmd === 'aibot_send_msg', { timeoutMs: 5_000, since })
    const content = String(frame.body.markdown.content)
    assert.ok(utf8Length(content) <= 120, `整条消息实际 ${utf8Length(content)} 字节`)
    assert.equal(
      server.received.filter((item) => item.cmd === 'aibot_subscribe').length,
      subscribes,
      '改预算不该重连：那会踢掉正在用的长连接',
    )

    await fiber.dispose()
    await h.dispose()
  })
})
