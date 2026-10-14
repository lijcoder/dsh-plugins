import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ImDocument, ImMessage } from '@lijcoder/dsh-im'
import { ImRegistry } from '@lijcoder/dsh-im'
import { createTestContext, fakeAgent, topLevel } from '@lijcoder/dsh-plugin-testkit'
import * as CommandsPlugin from '../src/index.js'
import { CommandRouter, parseCommand } from '../src/commands.js'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** 假通道：把自己收到消息的处理函数收下来，便于模拟「收到一条消息」。 */
function fakeChannel() {
  const subscriptions = new Set<(message: ImMessage) => void>()
  return {
    /** 模拟收到一条文本消息，返回被动回复的文档。 */
    async receive(text: string): Promise<ImDocument[]> {
      const replies: ImDocument[] = []
      const message = {
        channel: 'test',
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
      onMessage(handler: (message: ImMessage) => void) {
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
    assert.equal(replies[0]?.table, undefined)
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

  test('/list 按目录分组：首行打目录、同目录后续行首列留空，运行中的排在前面', async () => {
    const agents = [
      fakeAgent(topLevel('s1', '/work/a'), 'idle'),
      fakeAgent(topLevel('s2', '/work/a'), 'running'),
      fakeAgent(topLevel('s3', '/work/b'), 'running'),
    ]
    const { h, receive } = await harness({ agents, title: '标题' })
    const replies = await receive('/list')

    assert.equal(replies[0]?.heading, '🖥 DSH 会话（3）· 🏃 2 个运行中')
    assert.deepEqual(replies[0]?.table?.columns, ['目录', '会话', '状态', 'sessionId'])
    assert.deepEqual(replies[0]?.table?.rows, [
      // /work/a 组：运行中的 s2 排在空闲的 s1 前面
      ['/work/a', '标题', '🏃 运行中', 's2'],
      ['', '标题', '💤 空闲', 's1'],
      ['/work/b', '标题', '🏃 运行中', 's3'],
    ])
    await h.dispose()
  })

  test('没有工作目录的会话归到单独一组', async () => {
    const { h, receive } = await harness({
      agents: [fakeAgent({ id: 's1', header: {} } as never, 'idle')],
    })
    const replies = await receive('/list')
    assert.equal(replies[0]?.table?.rows[0]?.[0], '（无工作目录）')
    await h.dispose()
  })
})
