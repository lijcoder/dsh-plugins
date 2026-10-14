/**
 * profile 组合包的 patch 结构测试。
 *
 * 断言的是**结构**而不是字符串：row id、每行指向的完整包名、`disabled` 表达式读的是哪几个
 * 环境变量。原因是这类错误全都静默——行的 `name` 写错时启动器只打一句警告就丢弃该行，
 * profile 照常起来，功能没了。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { entryById, insertedEntries, jsExpr, parsePatch } from '@lijcoder/dsh-plugin-testkit'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  name: string
  files?: string[]
  exports?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}
const patches = parsePatch(readFileSync(`${root}/cordis.patch.yml`, 'utf8'))

/** 组合包期望插的四行，顺序即加载顺序。 */
const EXPECTED = [
  { id: 'im', name: '@lijcoder/dsh-im' },
  { id: 'im-wecom', name: '@lijcoder/dsh-im-wecom' },
  { id: 'notify', name: '@lijcoder/dsh-notify' },
  { id: 'im-commands', name: '@lijcoder/dsh-im-commands' },
]

describe('企微全家桶 combo patch', () => {
  test('恰好插入四行，且顺序是「接缝 → 通道 → 功能」', () => {
    const inserted = insertedEntries(patches)
    assert.deepEqual(
      inserted.map((entry) => ({ id: entry.id, name: entry.name })),
      EXPECTED,
    )
  })

  test('每行的 name 是完整包名（写错会被启动器静默丢弃）', () => {
    for (const expected of EXPECTED) {
      const entry = entryById(insertedEntries(patches), expected.id)
      assert.equal(entry?.name, expected.name, `row ${expected.id} 的 name 必须是完整包名`)
    }
  })

  test('三行由「三个变量齐了」统一开关，接缝行不受限', () => {
    const inserted = insertedEntries(patches)
    const expression = jsExpr(entryById(inserted, 'im-wecom')?.disabled)
    assert.equal(
      expression,
      '!(process.env.WECOM_BOT_ID && process.env.WECOM_BOT_SECRET && process.env.DSH_NOTIFY_TARGET)',
    )
    // 四行共用同一个开关（含 commands：它必须有通道才能挂载）
    for (const id of ['im-wecom', 'notify', 'im-commands']) {
      assert.equal(jsExpr(entryById(inserted, id)?.disabled), expression, `row ${id} 的开关应与通道行一致`)
    }
    assert.equal(entryById(inserted, 'im')?.disabled, undefined, '接缝行没有凭证可缺')
  })

  test('通道凭证与通知目标从环境变量注入，且组合包把通道钉成 wecom', () => {
    const inserted = insertedEntries(patches)
    assert.equal(jsExpr(entryById(inserted, 'im-wecom')?.config?.botId), 'process.env.WECOM_BOT_ID')
    assert.equal(jsExpr(entryById(inserted, 'im-wecom')?.config?.secret), 'process.env.WECOM_BOT_SECRET')
    assert.equal(jsExpr(entryById(inserted, 'notify')?.config?.target), 'process.env.DSH_NOTIFY_TARGET')
    // 钉死通道是组合包相对单装唯一多出来的东西：单装的 notify 不写 channel（自动选唯一通道）
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

  test('四个成员包都是 dependencies：add 本包即把它们装进 profile', () => {
    const deps = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    assert.deepEqual(Object.keys(deps.dependencies ?? {}).sort(), [...EXPECTED.map((e) => e.name)].sort())
  })
})
