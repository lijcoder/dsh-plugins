import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ImCapabilities, ImDocument } from '@lijcoder/dsh-im'
import { renderDocument, shortenCwd, truncateUtf8, utf8Length } from '../src/render.js'

/** 企微真实能力：支持富文本与标准 markdown 表格；字节上限取通道默认值。 */
const WECOM: ImCapabilities = {
  richText: true,
  tables: true,
  maxContentBytes: 20_480,
  proactive: true,
}

/** 声明不支持表格的通道（目前没有，但接缝允许）——用来验证降级路径。 */
const NO_TABLES: Partial<ImCapabilities> = { tables: false }

function render(document: ImDocument, overrides: Partial<ImCapabilities> = {}): string {
  return renderDocument(document, { ...WECOM, ...overrides })
}

describe('renderDocument', () => {
  test('标题、键值行、段落按企微 markdown 排版', () => {
    const content = render({
      heading: '✅ DSH 任务完成',
      facts: [
        { label: '会话', value: '修复登录超时' },
        { label: '状态', value: '成功' },
        { label: '目录', value: '/Users/someone/work/demo', code: true },
      ],
      sections: [{ title: '问题', body: '帮我把超时改大一点' }],
      footer: 'DSH 正在等你的授权，请回到会话里处理。',
    })

    assert.equal(content, [
      '## ✅ DSH 任务完成',
      '',
      '> **会话**：修复登录超时',
      '> **状态**：成功',
      '> **目录**：`/Users/someone/work/demo`',
      '',
      '**问题**',
      '帮我把超时改大一点',
      '',
      'DSH 正在等你的授权，请回到会话里处理。',
    ].join('\n'))
  })

  test('不使用这条通道不支持的 <font> 标签，状态靠 emoji', () => {
    const content = render({ heading: '❌ DSH 任务完成', facts: [{ label: '状态', value: '失败' }] })
    assert.doesNotMatch(content, /<font/)
    assert.match(content, /^## ❌/)
  })

  test('code 值把 home 目录缩写成 ~，普通值不缩写', () => {
    const content = render({
      facts: [
        { label: '目录', value: `${shortenCwd('/Users/someone', '/Users/someone')}/work`, code: true },
        { label: 'Session', value: 'sess-abc', code: true },
        { label: '状态', value: '/Users/someone/work' },
      ],
    })
    assert.match(content, /\*\*目录\*\*：`~\/work`/)
    assert.match(content, /\*\*Session\*\*：`sess-abc`/)
    assert.match(content, /\*\*状态\*\*：\/Users\/someone\/work$/)
  })

  test('声明不支持表格的通道降级成加粗表标题 + 逐行引用块，不把 | 原样吐出去', () => {
    const content = render({
      tables: [{
        title: '~/work/a',
        columns: ['会话', '状态', 'sessionId'],
        rows: [['修复登录超时', '🏃 运行中', 'session-1'], ['Greeting', '💤 空闲', 'session-2']],
      }],
    }, NO_TABLES)
    assert.doesNotMatch(content, /\|/)
    assert.equal(content, [
      '**~/work/a**',
      '',
      '> 会话：修复登录超时 · 状态：🏃 运行中 · sessionId：session-1',
      '> 会话：Greeting · 状态：💤 空闲 · sessionId：session-2',
    ].join('\n'))
  })

  test('企微声明支持表格：一个目录一张表，目录名加粗在表上方', () => {
    const content = render({
      tables: [
        { title: '~/work/a', columns: ['会话', '状态'], rows: [['A', '🏃 运行中'], ['B', '💤 空闲']] },
        { title: '~/work/b', columns: ['会话', '状态'], rows: [['C', '💤 空闲']] },
      ],
    })
    assert.equal(content, [
      '**~/work/a**',
      '',
      '| 会话 | 状态 |',
      '| --- | --- |',
      '| A | 🏃 运行中 |',
      '| B | 💤 空闲 |',
      '',
      '**~/work/b**',
      '',
      '| 会话 | 状态 |',
      '| --- | --- |',
      '| C | 💤 空闲 |',
    ].join('\n'))
  })

  test('表标题可以省略，也可以为空串（不当成表标题渲染）', () => {
    assert.equal(render({ tables: [{ columns: ['会话'], rows: [['A']] }] }), [
      '| 会话 |',
      '| --- |',
      '| A |',
    ].join('\n'))
    assert.equal(render({ tables: [{ title: '  ', columns: ['会话'], rows: [['A']] }] }), [
      '| 会话 |',
      '| --- |',
      '| A |',
    ].join('\n'))
  })

  test('没有行的表整个跳过（连标题一起）', () => {
    assert.equal(render({ tables: [{ title: '~/work/a', columns: ['会话'], rows: [] }] }), '')
  })

  test('单元格里的竖线和换行被转义，不撑坏表格', () => {
    const content = render({
      tables: [{ columns: ['会话', '状态'], rows: [['a|b\nc', '空闲']] }],
    })
    assert.match(content, /\| a\\\|b c \| 空闲 \|/)
  })

  test('richText=false 的通道拿到没有标记符号的纯文本', () => {
    const content = render({
      heading: '任务完成',
      facts: [{ label: '会话', value: 'x' }],
      sections: [{ title: '回复', body: '好了' }],
    }, { richText: false })
    assert.equal(content, ['任务完成', '', '  会话：x', '', '回复', '好了'].join('\n'))
  })

  test('空段落/空值不产生空行；没有任何内容时返回空串', () => {
    assert.equal(render({ sections: [{ title: '问题', body: '   ' }] }), '')
    assert.equal(render({ facts: [{ label: '会话', value: '' }] }), '')
    assert.equal(render({}), '')
  })

  test('整条内容受 maxContentBytes 约束，超长被截断', () => {
    const content = render({
      heading: '任务完成',
      sections: [{ title: '回复', body: '补充说明。'.repeat(5_000) }],
    })
    assert.ok(utf8Length(content) <= 20_480, `实际 ${utf8Length(content)} 字节`)
    assert.ok(content.startsWith('## 任务完成'))
  })
})

describe('truncateUtf8', () => {
  test('不超预算时原样返回，预算非正时返回空串', () => {
    assert.equal(truncateUtf8('abc', 3), 'abc')
    assert.equal(truncateUtf8('abc', 0), '')
    assert.equal(truncateUtf8('abc', -1), '')
  })

  test('不切断多字节字符，结果永远在预算内', () => {
    const content = truncateUtf8('中文中文中文', 10)
    assert.ok(utf8Length(content) <= 10)
    assert.match(content, /…$/)
    assert.equal(truncateUtf8('中文中文中文', 1), '')
  })
})

describe('shortenCwd', () => {
  test('home 目录缩写成 ~', () => {
    assert.equal(shortenCwd('/Users/a', '/Users/a'), '~')
    assert.equal(shortenCwd('/Users/a/work', '/Users/a'), '~/work')
    assert.equal(shortenCwd('/opt/x', '/Users/a'), '/opt/x')
  })
})
