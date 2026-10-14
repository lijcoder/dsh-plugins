/**
 * 命令功能包的 patch 结构测试。
 *
 * 这类错误全部是静默的：行的 `name` 写错时启动器只打一句警告就丢弃该行，
 * profile 照常起来，命令不再响应。
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
const entry = inserted.find((item) => item.id === 'im-commands')

describe('dsh-im-commands 的 bundle 层', () => {
  test('只插一行，name 是本包完整包名', () => {
    assert.deepEqual(inserted.map((item) => ({ id: item.id, name: item.name })), [
      { id: 'im-commands', name: '@lijcoder/dsh-im-commands' },
    ])
  })

  test('没有必填配置，因此不设 disabled —— 缺通道是启动期错误，不在这里挡', () => {
    assert.equal(entry?.disabled, undefined)
  })

  test('通道名从环境变量注入，可省略以便自动选唯一通道', () => {
    assert.equal(jsExpr(entry?.config?.channel), 'process.env.DSH_IM_CHANNEL')
  })

  test('声明 dsh.bundle 并把 patch 带进 files / exports', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(manifest.files?.includes('cordis.patch.yml'))
    assert.equal(manifest.exports?.['./cordis.patch.yml'], './cordis.patch.yml')
  })
})
