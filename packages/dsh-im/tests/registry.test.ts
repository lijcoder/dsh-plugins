import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { createTestContext } from '@lijcoder/dsh-plugin-testkit'
import ImRegistry, { type ImCapabilities, type ImChannel, type ImDocument } from '../src/index.js'

const CAPABILITIES: ImCapabilities = {
  richText: true,
  tables: false,
  maxContentBytes: 4_096,
  proactive: true,
}

/** 一个只记账的通道替身。 */
function fakeChannel() {
  const sent: Array<{ target: string; document: ImDocument }> = []
  const channel: ImChannel = {
    capabilities: CAPABILITIES,
    async send(target, document) {
      sent.push({ target, document })
    },
    onMessage() {
      return () => {}
    },
  }
  return { channel, sent }
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
