import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { createTestContext } from '@lijcoder/dsh-plugin-testkit'
import ImRegistry, {
  type ImCapabilities,
  type ImChannel,
  type ImDocument,
  type ImInbound,
  type ImMessage,
} from '../src/index.js'

const CAPABILITIES: ImCapabilities = {
  richText: true,
  tables: false,
  maxContentBytes: 4_096,
  proactive: true,
}

/** 一个只记账的通道替身；`deliver` 用来模拟收到一条消息。 */
function fakeChannel() {
  const sent: Array<{ target: string; document: ImDocument }> = []
  const subscribers = new Set<(message: ImInbound) => void>()
  const channel: ImChannel = {
    capabilities: CAPABILITIES,
    async send(target, document) {
      sent.push({ target, document })
    },
    onMessage(handler) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },
  }
  return {
    channel,
    sent,
    /** 模拟通道收到一条消息。 */
    deliver(text: string): void {
      const inbound: ImInbound = {
        conversation: { id: 'chat-1', kind: 'direct' },
        sender: { id: 'tester' },
        text,
        reply: async () => {},
      }
      for (const handler of [...subscribers]) handler(inbound)
    },
    get subscriberCount(): number {
      return subscribers.size
    },
  }
}

/** 挂一个「注册了若干通道」的 provider fiber。 */
function provider(...names: string[]) {
  return {
    name: 'test-provider',
    inject: ['im'],
    apply(ctx: Context) {
      for (const name of names) ctx.im.registerChannel(name, fakeChannel().channel)
    },
  }
}

describe('ImRegistry', () => {
  test('注册后可按名字取到通道', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const channel = fakeChannel().channel
    await h.mount({
      name: 'test-provider',
      inject: ['im'],
      apply(ctx: Context) {
        ctx.im.registerChannel('wecom', channel)
      },
    })

    assert.deepEqual(h.ctx.im.list(), ['wecom'])
    assert.equal(h.ctx.im.channel('wecom'), channel)
    await h.dispose()
  })

  test('只注册一个通道时可以不指名；通道名报错要能指出已注册了哪些', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const only = fakeChannel().channel
    await h.mount({
      name: 'test-provider',
      inject: ['im'],
      apply(ctx: Context) {
        ctx.im.registerChannel('wecom', only)
      },
    })
    assert.equal(h.ctx.im.channel(), only, '唯一通道时省略名字应自动选中')

    await h.mount(provider('feishu'))
    assert.throws(() => h.ctx.im.channel(), /必须显式指定 channel.*wecom、feishu/s)
    assert.throws(() => h.ctx.im.channel('dingtalk'), /没有名为 "dingtalk" 的 IM 通道.*wecom、feishu/s)
    await h.dispose()
  })

  test('一个通道都没注册时取用报错', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    assert.throws(() => h.ctx.im.channel('wecom'), /没有名为 "wecom" 的 IM 通道/)
    assert.throws(() => h.ctx.im.channel(), /还没有注册任何 IM 通道/)
    await h.dispose()
  })

  test('同名重复注册直接抛错，不静默覆盖', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    await h.mount(provider('wecom'))
    await assert.rejects(async () => h.mount(provider('wecom')), /IM 通道 "wecom" 已注册/)
    await h.dispose()
  })

  test('provider 卸载后通道随之注销', async () => {
    const h = createTestContext()
    await h.mount(ImRegistry)
    const fiber = await h.mount(provider('wecom'))
    assert.deepEqual(h.ctx.im.list(), ['wecom'])

    await fiber.dispose()
    assert.deepEqual(h.ctx.im.list(), [], '通道应随 provider fiber 一起注销')
    assert.throws(() => h.ctx.im.channel('wecom'), /没有名为 "wecom" 的 IM 通道/)
    await h.dispose()
  })
})

describe('ImRegistry 的入站转发', () => {
  /** 挂一个把给定通道注册为 `name` 的 provider。 */
  function channelProvider(name: string, channel: ImChannel) {
    return {
      name: `provider-${name}`,
      inject: ['im'],
      apply(ctx: Context) {
        ctx.im.registerChannel(name, channel)
      },
    }
  }

  test('订阅者收到任何通道的消息，channel 取自注册名', async () => {
    const h = createTestContext()
    const wecom = fakeChannel()
    const feishu = fakeChannel()
    await h.mount(ImRegistry)
    await h.mount(channelProvider('wecom', wecom.channel))
    await h.mount(channelProvider('feishu', feishu.channel))

    const seen: ImMessage[] = []
    h.ctx.im.onMessage((message) => seen.push(message))

    wecom.deliver('来自企微')
    feishu.deliver('来自飞书')

    assert.deepEqual(seen.map((message) => [message.channel, message.text]), [
      ['wecom', '来自企微'],
      ['feishu', '来自飞书'],
    ])
    await h.dispose()
  })

  test('通道在订阅之后才注册，也照样收得到', async () => {
    const h = createTestContext()
    const seen: ImMessage[] = []
    await h.mount(ImRegistry)
    h.ctx.im.onMessage((message) => seen.push(message))

    const late = fakeChannel()
    await h.mount(channelProvider('wecom', late.channel))
    late.deliver('迟到的通道')

    assert.deepEqual(seen.map((message) => message.text), ['迟到的通道'])
    await h.dispose()
  })

  test('通道注销后不再转发它的消息', async () => {
    const h = createTestContext()
    const wecom = fakeChannel()
    await h.mount(ImRegistry)
    const fiber = await h.mount(channelProvider('wecom', wecom.channel))
    const seen: ImMessage[] = []
    h.ctx.im.onMessage((message) => seen.push(message))

    wecom.deliver('注销前')
    await fiber.dispose()
    assert.equal(wecom.subscriberCount, 0, '注销时应退掉对通道的订阅')
    wecom.deliver('注销后')

    assert.deepEqual(seen.map((message) => message.text), ['注销前'])
    await h.dispose()
  })

  test('取消订阅后不再收到', async () => {
    const h = createTestContext()
    const wecom = fakeChannel()
    await h.mount(ImRegistry)
    await h.mount(channelProvider('wecom', wecom.channel))

    const seen: ImMessage[] = []
    const off = h.ctx.im.onMessage((message) => seen.push(message))
    wecom.deliver('第一条')
    off()
    wecom.deliver('第二条')

    assert.deepEqual(seen.map((message) => message.text), ['第一条'])
    await h.dispose()
  })
})
