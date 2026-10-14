/**
 * 企微通道包的 patch 结构测试。
 *
 * 这类错误全部是静默的：行的 `name` 写错时启动器只打一句警告就丢弃该行，
 * profile 照常起来，通道不再挂载。
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
const entry = inserted.find((item) => item.id === 'im-wecom')

describe('dsh-im-wecom 的 bundle 层', () => {
  test('只插一行，name 是本包完整包名', () => {
    assert.deepEqual(inserted.map((item) => ({ id: item.id, name: item.name })), [
      { id: 'im-wecom', name: '@lijcoder/dsh-im-wecom' },
    ])
  })

  test('缺凭证时这一行停用，而不是让 profile 起不来', () => {
    assert.equal(jsExpr(entry?.disabled), '!(process.env.WECOM_BOT_ID && process.env.WECOM_BOT_SECRET)')
  })

  test('凭证从环境变量注入', () => {
    assert.equal(jsExpr(entry?.config?.botId), 'process.env.WECOM_BOT_ID')
    assert.equal(jsExpr(entry?.config?.secret), 'process.env.WECOM_BOT_SECRET')
  })

  test('声明 dsh.bundle 并把 patch 带进 files / exports', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(manifest.files?.includes('cordis.patch.yml'))
    assert.equal(manifest.exports?.['./cordis.patch.yml'], './cordis.patch.yml')
  })
})
