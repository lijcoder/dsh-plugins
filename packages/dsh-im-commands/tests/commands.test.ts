import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ImDocument, ImInbound } from '@lijcoder/dsh-im'
import { ImRegistry } from '@lijcoder/dsh-im'
import { createTestContext, fakeAgent, topLevel } from '@lijcoder/dsh-plugin-testkit'
import * as CommandsPlugin from '../src/index.js'
import { CommandRouter, parseCommand } from '../src/commands.js'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** 假通道：把自己上报的处理函数收下来，便于模拟「收到一条消息」。 */
function fakeChannel() {
  const subscriptions = new Set<(message: ImInbound) => void>()
  return {
    /** 模拟收到一条文本消息，返回被动回复的文档。 */
    async receive(text: string): Promise<ImDocument[]> {
      const replies: ImDocument[] = []
      const message = {
        conversation: { id: 'chat-1', kind: 'direct' as const },
        sender: { id: 'tester' },
        text,
        reply: async (document: ImDocument) => {
          replies.push(document)
        },
      }
      for (const handler of subscriptions) handler(message)
      await flush()
      return replies
    },
    channel: {
      capabilities: { richText: true, tables: false, maxContentBytes: 4_096, proactive: true },
      async send() {},
      onMessage(handler: (message: ImInbound) => void) {
        subscriptions.add(handler)
        return () => subscriptions.delete(handler)
      },
    },
  }
}

/** 挂一整套真实 Context：接缝 + 假通道 + 被测的命令插件。 */
async function harness(options: { agents?: ReturnType<typeof fakeAgent>[]; title?: string } = {}) {
  const h = createTestContext()
  const fake = fakeChannel()
  h.provide('agents', { roots: () => options.agents ?? [] })
  h.provide('sessionProjections', { stateOf: () => options.title })
  await h.mount(ImRegistry)
  await h.mount({
    name: 'test-channel',
    inject: ['im'],
    apply(ctx: Context) {
      ctx.im.registerChannel('wecom', fake.channel)
    },
  })
  await h.mount(CommandsPlugin, { channel: 'wecom' })
  return { h, receive: fake.receive }
}

describe('parseCommand', () => {
  test('识别命令与参数', () => {
    assert.deepEqual(parseCommand('/list'), { name: 'list', args: '' })
    assert.deepEqual(parseCommand('/list  abc '), { name: 'list', args: 'abc' })
    assert.deepEqual(parseCommand('/LIST'), { name: 'list', args: '' })
  })

  test('剥掉群聊里的 @提及 前缀', () => {
    assert.deepEqual(parseCommand('@测试机器人 /help'), { name: 'help', args: '' })
    assert.deepEqual(parseCommand('@机器人\u2005/ping x'), { name: 'ping', args: 'x' })
  })

  test('不是命令就返回 undefined（普通聊天不该被回复）', () => {
    assert.equal(parseCommand('在吗'), undefined)
    assert.equal(parseCommand('http://example.com/list'), undefined)
    assert.equal(parseCommand('/'), undefined)
    assert.equal(parseCommand('//x'), undefined)
  })
})

describe('CommandRouter', () => {
  test('未知命令回一条带 /help 的提示', async () => {
    const router = new CommandRouter()
    router.register({ name: 'list', summary: '列出当前活着的会话', run: () => ({}) })
    const replies: ImDocument[] = []
    await router.handle({ text: '/nope', reply: async (document) => void replies.push(document) })
    assert.match(replies[0]?.heading ?? '', /未知命令 `\/nope`/)
    assert.deepEqual(replies[0]?.facts, [{ label: '/list', value: '列出当前活着的会话' }])
  })

  test('命令抛错时回一条 ⚠️，并回调 onError（不是静默没反应）', async () => {
    const seen: string[] = []
    const router = new CommandRouter((_error, name) => seen.push(name))
    router.register({ name: 'boom', summary: '会炸', run: () => { throw new Error('炸了') } })
    const replies: ImDocument[] = []
    await router.handle({ text: '/boom', reply: async (document) => void replies.push(document) })
    assert.deepEqual(seen, ['boom'])
    assert.match(replies[0]?.heading ?? '', /命令 `\/boom` 执行失败/)
    assert.equal(replies[0]?.sections?.[0]?.body, '炸了')
  })

  test('不是命令时什么都不回', async () => {
    const router = new CommandRouter()
    const replies: ImDocument[] = []
    await router.handle({ text: '在吗', reply: async (document) => void replies.push(document) })
    assert.equal(replies.length, 0)
  })
})

describe('registerCommands', () => {
  test('普通聊天不回复；/help 按注册顺序列出命令', async () => {
    const { h, receive } = await harness()
    assert.equal((await receive('在吗')).length, 0)

    const replies = await receive('/help')
    assert.equal(replies.length, 1)
    assert.equal(replies[0]?.heading, '🤖 DSH 命令')
    assert.deepEqual(replies[0]?.facts, [
      { label: '/list', value: '列出当前活着的会话' },
      { label: '/help', value: '列出所有命令' },
    ])
    await h.dispose()
  })

  test('群聊里 @机器人 + 命令可以命中路由', async () => {
    const { h, receive } = await harness()
    const replies = await receive('@测试机器人 /help')
    assert.equal(replies.length, 1)
    assert.equal(replies[0]?.heading, '🤖 DSH 命令')
    await h.dispose()
  })

  test('/list 在没有任何会话时给一句说明', async () => {
    const { h, receive } = await harness()
    const replies = await receive('/list')
    assert.equal(replies[0]?.heading, '🖥 DSH 会话')
    assert.match(replies[0]?.footer ?? '', /当前没有活着的会话/)
    assert.equal(replies[0]?.tables, undefined)
    await h.dispose()
  })

  test('/list 标题在括号后追加运行中的个数——打开就能看到有几个在跑', async () => {
    const running = await harness({
      agents: [
        fakeAgent(topLevel('s1', '/work/a'), 'running'),
        fakeAgent(topLevel('s2', '/work/a'), 'idle'),
        fakeAgent(topLevel('s3', '/work/b'), 'running'),
      ],
    })
    assert.equal((await running.receive('/list'))[0]?.heading, '🖥 DSH 会话（3）· 🏃 2 个运行中')
    await running.h.dispose()

    const idle = await harness({ agents: [fakeAgent(topLevel('s1', '/work/a'), 'idle')] })
    assert.equal((await idle.receive('/list'))[0]?.heading, '🖥 DSH 会话（1）· 🏃 0 个运行中')
    await idle.h.dispose()
  })

  test('/list 一个目录一张表，目录当表标题，表里是会话与状态', async () => {
    const agents = [
      fakeAgent(topLevel('s1', '/work/a'), 'idle'),
      fakeAgent(topLevel('s2', '/work/a'), 'running'),
      fakeAgent(topLevel('s3', '/work/b'), 'running'),
    ]
    const { h, receive } = await harness({ agents, title: '标题' })
    const replies = await receive('/list')

    assert.equal(replies[0]?.heading, '🖥 DSH 会话（3）· 🏃 2 个运行中')
    assert.deepEqual(replies[0]?.tables, [
      {
        title: '/work/a',
        columns: ['会话', '状态', 'sessionId'],
        // 组内运行中的 s2 排在空闲的 s1 前面
        rows: [['标题', '🏃 运行中', 's2'], ['标题', '💤 空闲', 's1']],
      },
      { title: '/work/b', columns: ['会话', '状态', 'sessionId'], rows: [['标题', '🏃 运行中', 's3']] },
    ])
    await h.dispose()
  })

  test('/list 同目录的会话留在同一张表里，不按状态快照拆开', async () => {
    // 排序是「运行中先排」，但归组发生在排序之后：不能因为运行状态不同就把同一个目录
    // 的会话拆成两张表。
    const { h, receive } = await harness({
      agents: [
        fakeAgent(topLevel('s1', '/work/a'), 'idle'),
        fakeAgent(topLevel('s2', '/work/b'), 'idle'),
        fakeAgent(topLevel('s3', '/work/a'), 'running'),
      ],
      title: '标题',
    })
    const replies = await receive('/list')

    assert.deepEqual(replies[0]?.tables?.map((table) => table.title), ['/work/a', '/work/b'])
    assert.deepEqual(replies[0]?.tables?.[0]?.rows, [
      ['标题', '🏃 运行中', 's3'],
      ['标题', '💤 空闲', 's1'],
    ])
    await h.dispose()
  })

  test('没有工作目录的会话归到单独一组', async () => {
    const { h, receive } = await harness({
      agents: [fakeAgent({ id: 's1', header: {} } as never, 'idle')],
    })
    const replies = await receive('/list')
    assert.equal(replies[0]?.tables?.[0]?.title, '（无工作目录）')
    await h.dispose()
  })

  test('命令功能先挂载、通道后挂载也照样收得到消息', async () => {
    // 这正是让 profile 起不来的那个竞态：loader 先 await import 模块再创建 fiber，
    // 且不等激活，所以行序不决定激活顺序 —— 命令行完全可能先于通道行激活。
    const h = createTestContext()
    const fake = fakeChannel()
    h.provide('agents', { roots: () => [fakeAgent(topLevel('s1', '/work/demo'), 'idle')] })
    h.provide('sessionProjections', { stateOf: () => '标题' })

    await h.mount(ImRegistry)
    await h.mount(CommandsPlugin, { channel: 'wecom' }) // ← 通道还不存在
    await h.mount({
      name: 'test-channel',
      inject: ['im'],
      apply(ctx: Context) {
        ctx.im.registerChannel('wecom', fake.channel)
      },
    })

    const replies = await fake.receive('/list')
    assert.equal(replies.length, 1, '通道后到，命令功能也该收到它的消息')
    assert.match(replies[0]?.heading ?? '', /^🖥 DSH 会话（1）/)
    await h.dispose()
  })

  test('配了通道名就只收那个通道的；没配则全收', async () => {
    const h = createTestContext()
    const wecom = fakeChannel()
    const feishu = fakeChannel()
    h.provide('agents', { roots: () => [] })
    h.provide('sessionProjections', { stateOf: () => undefined })
    await h.mount(ImRegistry)
    await h.mount({
      name: 'channels',
      inject: ['im'],
      apply(ctx: Context) {
        ctx.im.registerChannel('wecom', wecom.channel)
        ctx.im.registerChannel('feishu', feishu.channel)
      },
    })

    const scoped = await h.mount(CommandsPlugin, { channel: 'wecom' })
    assert.equal((await wecom.receive('/help')).length, 1, '指名 wecom 时该收')
    assert.equal((await feishu.receive('/help')).length, 0, '指名 wecom 时不该收 feishu 的')
    await scoped.dispose()

    await h.mount(CommandsPlugin, {})
    assert.equal((await wecom.receive('/help')).length, 1)
    assert.equal((await feishu.receive('/help')).length, 1, '没指名则每个通道都收')
    await h.dispose()
  })
})
