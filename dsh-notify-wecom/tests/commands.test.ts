import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { WecomCommandRouter, parseCommand, registerCommands } from '../src/commands.js'
import { fakeContext, testConfig, topLevel, session, FakeWecom } from './fixtures.js'

describe('parseCommand', () => {
  test('识别斜杠命令与参数', () => {
    assert.deepEqual(parseCommand('/list'), { name: 'list', args: '' })
    assert.deepEqual(parseCommand('/list  foo  bar '), { name: 'list', args: 'foo  bar' })
  })

  test('剥掉群聊里的 @提及 前缀，大小写不敏感', () => {
    assert.deepEqual(parseCommand('@DSH机器人 /List'), { name: 'list', args: '' })
    assert.deepEqual(parseCommand('@bot /help me'), { name: 'help', args: 'me' })
  })

  test('非命令文本不识别', () => {
    assert.equal(parseCommand('你好'), undefined)
    assert.equal(parseCommand('/'), undefined)
    assert.equal(parseCommand('  '), undefined)
    // 只有整行以命令开头才算，正文里出现斜杠不算。
    assert.equal(parseCommand('看看 /list 的输出'), undefined)
  })
})

describe('WecomCommandRouter', () => {
  function router() {
    const instance = new WecomCommandRouter()
    instance.register({ name: 'a', summary: '第一个', run: () => 'AAA' })
    instance.register({ name: 'b', summary: '第二个', run: (args) => `BBB:${args}` })
    return instance
  }

  /** 跑一条命令，收集回复。 */
  async function run(text: string, maxContentBytes = 4_096): Promise<string[]> {
    const replies: string[] = []
    await router().handle({ text, reply: async (markdown: string) => { replies.push(markdown) } }, maxContentBytes)
    return replies
  }

  test('命中命令就执行并回复', async () => {
    assert.deepEqual(await run('/a'), ['AAA'])
    assert.deepEqual(await run('/b 参数'), ['BBB:参数'])
  })

  test('非命令文本不回复', async () => {
    assert.deepEqual(await run('你好'), [])
  })

  test('未知命令回 help', async () => {
    const [reply] = await run('/nope')
    assert.ok(reply)
    assert.match(reply, /未知命令 `\/nope`/)
    assert.match(reply, /`\/a` 第一个/)
  })

  test('/help 按注册顺序列出命令', async () => {
    const [reply] = await run('/help')
    assert.ok(reply)
    assert.match(reply, /^## 🤖 DSH 命令$/m)
    assert.deepEqual(
      reply.split('\n').filter((line) => line.startsWith('> `')),
      ['> `/a` 第一个', '> `/b` 第二个'],
    )
  })

  test('命令抛错时回一条 ⚠️，并回调 onError（不是静默没反应）', async () => {
    const errors: string[] = []
    const instance = new WecomCommandRouter((error, name) => errors.push(`${name}:${String(error)}`))
    instance.register({ name: 'boom', summary: '会炸', run: () => { throw new Error('服务没就绪') } })

    const replies: string[] = []
    await instance.handle({ text: '/boom', reply: async (markdown: string) => { replies.push(markdown) } }, 4_096)

    assert.deepEqual(errors, ['boom:Error: 服务没就绪'])
    assert.match(replies[0] ?? '', /⚠️ 命令 `\/boom` 执行失败：服务没就绪/)
  })

  test('回复受字节预算约束', async () => {
    const [reply] = await run('/b ' + 'x'.repeat(500), 80)
    assert.ok(reply)
    assert.ok(Buffer.byteLength(reply, 'utf8') <= 80)
  })
})

describe('registerCommands', () => {
  function build(
    config = testConfig(),
    agents = [
      { session: topLevel('sess-1', '/Users/lijie/work/ai/test/chat'), status: 'running' as const },
      { session: topLevel('sess-2', '/Users/lijie/work/ai/other'), status: 'idle' as const },
    ],
    titleOf: (target: { id: string }) => string | undefined = (target) => (target.id === 'sess-1' ? 'Greeting' : undefined),
  ) {
    const wecom = new FakeWecom()
    const { ctx } = fakeContext({ wecom, titleOf, agents })
    registerCommands(ctx, config)
    return { wecom }
  }

  test('/list 按目录分组：目录一行 + 三列表格', async () => {
    const [reply] = await build().wecom.receive('/list')
    assert.ok(reply)
    assert.match(reply, /^## 🖥 DSH 会话（2）$/m)
    // 目录一行，按路径排序
    assert.match(reply, /^\*\*`~\/work\/ai\/other`\*\*$/m)
    assert.match(reply, /^\*\*`~\/work\/ai\/test\/chat`\*\*$/m)
    assert.ok(reply.indexOf('**`~/work/ai/other`**') < reply.indexOf('**`~/work/ai/test/chat`**'))
    // 表头每个目录一份
    assert.equal((reply.match(/^\| 会话 \| 状态 \| sessionId \|$/gm) ?? []).length, 2)
    assert.equal((reply.match(/^\| --- \| --- \| --- \|$/gm) ?? []).length, 2)
    // 数据行：会话 / 状态 / sessionId（sess-2 没有标题，退化为「未命名」）
    assert.match(reply, /^\| （未命名） \| 💤 空闲 \| sess-2 \|$/m)
    assert.match(reply, /^\| Greeting \| 🏃 运行中 \| sess-1 \|$/m)
  })

  test('/list 同一目录的会话共用一个表格，运行中的排在前面', async () => {
    const [reply] = await build(testConfig(), [
      { session: topLevel('sess-a', '/work/demo'), status: 'idle' as const },
      { session: topLevel('sess-b', '/work/demo'), status: 'running' as const },
      { session: topLevel('sess-c', '/work/other'), status: 'running' as const },
    ]).wecom.receive('/list')

    assert.ok(reply)
    assert.equal((reply.match(/^\*\*`~?\/?work\/demo`\*\*$/gm) ?? []).length, 1)
    assert.equal((reply.match(/^\| 会话 \| 状态 \| sessionId \|$/gm) ?? []).length, 2)
    assert.match(reply, /^\| （未命名） \| 🏃 运行中 \| sess-b \|$/m)
    assert.ok(reply.indexOf('| sess-b |') < reply.indexOf('| sess-a |'))
  })

  test('/list 没有工作目录的会话单独成组，标题里的竖线被转义', async () => {
    const [reply] = await build(testConfig(), [
      { session: session('sess-x'), status: 'running' as const },
    ]).wecom.receive('/list')
    assert.match(reply ?? '', /^\*\*（无工作目录）\*\*$/m)
    assert.match(reply ?? '', /^\| （未命名） \| 🏃 运行中 \| sess-x \|$/m)

    const [escaped] = await build(testConfig(), [
      { session: session('sess-y'), status: 'running' as const },
    ], () => 'a | b\nc').wecom.receive('/list')
    assert.match(escaped ?? '', /^\| a \\\| b c \| 🏃 运行中 \| sess-y \|$/m)
  })

  test('没有活着的会话时给一句说明', async () => {
    const [reply] = await build(testConfig(), []).wecom.receive('/list')
    assert.match(reply ?? '', /当前没有活着的会话/)
  })

  test('/help 列出 /list 与 /help', async () => {
    const [reply] = await build().wecom.receive('/help')
    assert.match(reply ?? '', /`\/list` 列出当前活着的会话/)
    assert.match(reply ?? '', /`\/help` 列出所有命令/)
  })

  test('普通聊天不回复', async () => {
    assert.deepEqual(await build().wecom.receive('在吗'), [])
  })

  test('命令回复走收到的那条消息，不用另配目标', async () => {
    const { wecom } = build()
    assert.deepEqual(wecom.sent, [])
    await wecom.receive('/help')
    assert.deepEqual(wecom.sent, [])
  })
})
