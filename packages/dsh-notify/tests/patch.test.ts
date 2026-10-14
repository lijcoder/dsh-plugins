/**
 * 通知功能包的 patch 结构测试。
 *
 * 这类错误全部是静默的：行的 `name` 写错时启动器只打一句警告就丢弃该行，
 * profile 照常起来，通知不再发。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { insertedEntries, jsExpr, parsePatch } from '@lijcoder/dsh-plugin-testkit'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  files?: string[]
  exports?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}
const inserted = insertedEntries(parsePatch(readFileSync(`${root}/cordis.patch.yml`, 'utf8')))
const entry = inserted.find((item) => item.id === 'notify')

describe('dsh-notify 的 bundle 层', () => {
  test('只插一行，name 是本包完整包名', () => {
    assert.deepEqual(inserted.map((item) => ({ id: item.id, name: item.name })), [
      { id: 'notify', name: '@lijcoder/dsh-notify' },
    ])
  })

  test('缺目标时这一行停用（通知本来也没地方发）', () => {
    assert.equal(jsExpr(entry?.disabled), '!process.env.DSH_NOTIFY_TARGET')
  })

  test('目标与通道都从环境变量注入；通道可省略以便自动选唯一通道', () => {
    assert.equal(jsExpr(entry?.config?.target), 'process.env.DSH_NOTIFY_TARGET')
    assert.equal(jsExpr(entry?.config?.channel), 'process.env.DSH_NOTIFY_CHANNEL')
  })

  test('声明 dsh.bundle 并把 patch 带进 files / exports', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(manifest.files?.includes('cordis.patch.yml'))
    assert.equal(manifest.exports?.['./cordis.patch.yml'], './cordis.patch.yml')
  })
})
