/**
 * profile 组合包的 patch 结构测试。
 *
 * 断言的是**结构**而不是字符串：row id、每行指向的完整包名、`disabled` 表达式读的是哪几个
 * 环境变量。原因是这类错误全都静默——行的 `name` 写错时启动器只打一句警告就丢弃该行，
 * profile 照常起来，功能没了。
 *
 * 另外断言「四个成员包确实没有各自的 patch」：那是这套设计成立的前提（见 README），
 * 不该只靠人记得。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { entryById, insertedEntries, jsExpr, parsePatch } from '@lijcoder/dsh-plugin-testkit'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  name: string
  files?: string[]
  exports?: Record<string, string>
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}
const patches = parsePatch(readFileSync(`${root}/cordis.patch.yml`, 'utf8'))

/** 期望插的四行，顺序即加载顺序。 */
const EXPECTED = [
  { id: 'im', name: '@lijcoder/dsh-im' },
  { id: 'im-wecom', name: '@lijcoder/dsh-im-wecom' },
  { id: 'notify', name: '@lijcoder/dsh-notify' },
  { id: 'im-commands', name: '@lijcoder/dsh-im-commands' },
]

/** 四行共用的启用开关：三个变量齐了整条链路才启用。 */
const GATE = '!(process.env.WECOM_BOT_ID && process.env.WECOM_BOT_SECRET && process.env.IM_NOTIFY_TARGET)'

describe('企微全家桶 combo patch', () => {
  test('恰好插入四行，且顺序是「接缝 → 通道 → 功能」', () => {
    assert.deepEqual(
      insertedEntries(patches).map((entry) => ({ id: entry.id, name: entry.name })),
      EXPECTED,
    )
  })

  test('每行的 name 是完整包名（写错会被启动器静默丢弃）', () => {
    for (const expected of EXPECTED) {
      assert.equal(entryById(insertedEntries(patches), expected.id)?.name, expected.name)
    }
  })

  test('三行由「三个变量齐了」统一开关，接缝行不受限', () => {
    const inserted = insertedEntries(patches)
    for (const id of ['im-wecom', 'notify', 'im-commands']) {
      assert.equal(jsExpr(entryById(inserted, id)?.disabled), GATE, `row ${id} 的开关应与通道行一致`)
    }
    assert.equal(entryById(inserted, 'im')?.disabled, undefined, '接缝行没有配置可缺')
  })

  test('环境变量名不以 DSH_ 等保留前缀开头（否则写进 .env 会让 dsh 直接报错退出）', () => {
    for (const entry of insertedEntries(patches)) {
      const names = [jsExpr(entry.disabled), ...Object.values(entry.config ?? {}).map(jsExpr)]
      for (const expression of names) {
        if (expression === undefined) continue
        for (const match of expression.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
          assert.doesNotMatch(
            match[1]!,
            /^(DSH_|XDG_|DYLD_|BASH_FUNC_)/,
            `${match[1]} 是启动器保留名，只能 export，不能写进 .env`,
          )
        }
      }
    }
  })

  test('通道凭证与通知目标从环境变量注入，通道被钉成 wecom', () => {
    const inserted = insertedEntries(patches)
    assert.equal(jsExpr(entryById(inserted, 'im-wecom')?.config?.botId), 'process.env.WECOM_BOT_ID')
    assert.equal(jsExpr(entryById(inserted, 'im-wecom')?.config?.secret), 'process.env.WECOM_BOT_SECRET')
    assert.equal(jsExpr(entryById(inserted, 'notify')?.config?.target), 'process.env.IM_NOTIFY_TARGET')
    assert.equal(entryById(inserted, 'notify')?.config?.channel, 'wecom')
    assert.equal(entryById(inserted, 'im-commands')?.config?.channel, 'wecom')
  })
})

describe('企微全家桶打包与依赖', () => {
  test('声明 dsh.bundle 并把 patch 带进 files / exports（否则装上去不生效）', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(manifest.files?.includes('cordis.patch.yml'), 'files 必须包含 cordis.patch.yml')
    assert.equal(manifest.exports?.['./cordis.patch.yml'], './cordis.patch.yml')
  })

  test('四个成员包都是 dependencies，且它们自己不带 patch', () => {
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), EXPECTED.map((e) => e.name).sort())
    for (const { name } of EXPECTED) {
      const member = require(`${name}/package.json`) as { dsh?: { bundle?: unknown }; private?: boolean }
      assert.equal(
        member.dsh?.bundle,
        undefined,
        `${name} 不该带 dsh.bundle：成员一旦可单装，与组合包同时装就会让插件挂载两次`,
      )
    }
  })
})
