/**
 * 「还没配凭证」和「刚在插件页里填好凭证」这两条路径的集成测试。
 *
 * 这是这套配置页真正要保证的事，而且**两条都不会在单测里自己暴露**：
 *   - 缺凭证时插件必须照常挂载：行一停用，设置里就没有这个条目，用户连表单都看不到；
 *   - 凭证是 volatile 字段，改完 loader 只就地更新引用、**不重挂插件**，
 *     所以「填完就能连上」靠的是插件自己监听 `loader/volatile-update`。
 *
 * 直接测 `provideWecomChannel`（生命周期的主人）：真挂插件要走 schema 解析，
 * 而这里要的是「同一个引用被换值」——那正是 loader 干的事。
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type { Context, Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import { ImRegistry } from '@lijcoder/dsh-im'
import * as WecomPlugin from '../src/index.js'
import { createTestContext } from '@lijcoder/dsh-plugin-testkit'
import type { Config } from '../src/config.js'
import { provideWecomChannel } from '../src/channel.js'
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

/** 可写的 volatile 引用替身：插件只会读它，换值由测试做（loader 也是这么换的）。 */
function ref<T>(value: T): Volatile<T> & { set(next: T): void } {
  let current = value
  return {
    get: () => current as VolatileSnapshot<T>,
    set: (next) => { current = next },
  }
}

/** 一份只差凭证的配置。 */
function config(botId: Volatile<string | undefined>, secret: Volatile<string | undefined>): Config {
  return {
    botId,
    secret,
    wsUrl: info.wsUrl,
    heartbeatInterval: 30_000,
    reconnectInterval: 1_000,
    maxReconnectAttempts: 10,
    maxAuthFailureAttempts: 5,
    requestTimeout: 10_000,
    connectTimeoutMs: 15_000,
    maxContentBytes: ref(20_480),
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200))

/** 等一个条件成立，用于断言「最终状态」而不是「恰好此刻的状态」。 */
async function eventually(predicate: () => boolean, message: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(message)
}

describe('凭证从插件页填进来', () => {
  test('缺凭证时插件照常挂载：不注册通道、也不建连（表单才有地方填）', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    await h.mount(WecomPlugin, { wsUrl: info.wsUrl })
    await flush()

    assert.deepEqual(h.ctx.im.list(), [], '没凭证就不该注册一条连不上的通道')
    assert.equal(
      server.received.some((frame) => frame.cmd === 'aibot_subscribe'),
      false,
      '没凭证不该建长连接',
    )
    assert.ok(h.logs.has('企微通道未配置'))
    await h.dispose()
  })

  test('凭证被 volatile 更新后自动建连；卸载后断开', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const botId = ref<string | undefined>(undefined)
    const secret = ref<string | undefined>(undefined)
    const fiber = await h.mount({
      name: 'wecom-under-test',
      inject: ['im'],
      apply(ctx: Context) {
        provideWecomChannel(ctx, config(botId, secret))
      },
    })
    await flush()
    assert.deepEqual(h.ctx.im.list(), [])

    // loader 更新 volatile 引用后就发这个事件——插件只能从这里知道「用户刚存了凭证」。
    const since = server.received.length
    botId.set('mock-bot')
    secret.set('mock-secret')
    fiber.ctx.emit('loader/volatile-update', [['botId'], ['secret']])

    await server.waitFor((frame) => frame.cmd === 'aibot_subscribe', { timeoutMs: 5_000, since })
    assert.deepEqual(h.ctx.im.list(), ['wecom'])

    await fiber.dispose()
    assert.deepEqual(h.ctx.im.list(), [], '卸载后通道注册也要收回')
    await eventually(() => !server.connected, '卸载后长连接应当断开')
    await h.dispose()
  })

  test('凭证更新与卸载撞在一起时，卸载仍然收干净：不留注册、不留连接', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const botId = ref<string | undefined>(undefined)
    const secret = ref<string | undefined>(undefined)
    const fiber = await h.mount({
      name: 'wecom-under-test',
      inject: ['im'],
      apply(ctx: Context) {
        provideWecomChannel(ctx, config(botId, secret))
      },
    })

    // 用户点保存的同一瞬间这行被停用：启停已经排队，context 马上就不活了。
    botId.set('late-bot')
    secret.set('late-secret')
    fiber.ctx.emit('loader/volatile-update', [['botId'], ['secret']])
    await fiber.dispose()
    await flush()

    assert.deepEqual(h.ctx.im.list(), [], '卸载后不该还留着通道注册')
    await eventually(() => !server.connected, '卸载后长连接应当断开')
    await h.dispose()
  })

  test('凭证被改掉（换了一个机器人）时重连，不留两条连接', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const botId = ref('bot-a')
    const secret = ref('secret-a')
    const fiber = await h.mount({
      name: 'wecom-under-test',
      inject: ['im'],
      apply(ctx: Context) {
        provideWecomChannel(ctx, config(botId, secret))
      },
    })
    await server.waitFor((frame) => frame.cmd === 'aibot_subscribe', { timeoutMs: 5_000 })

    const since = server.received.length
    botId.set('bot-b')
    fiber.ctx.emit('loader/volatile-update', [['botId']])

    // 重连 = 又一条订阅；旧连接由 dispose 收掉，服务端只该看到一条活着的连接。
    await server.waitFor((frame) => frame.cmd === 'aibot_subscribe', { timeoutMs: 5_000, since })
    assert.notEqual(server.connected, false)
    await fiber.dispose()
    await h.dispose()
  })
})
