/**
 * 通道配置的 schema 测试。
 *
 * 盯三件事，都是「错了不会报错」的那种：
 *   - `maxContentBytes` 的默认值有出处（SDK 文档写的 `replyStream` 上限 20480 字节），
 *     被谁悄悄改小都会让长内容被无声截断；
 *   - 配置页能编辑的字段必须是 volatile 且可缺：这是页面能工作的前提（改完不重挂、
 *     缺了也能挂载），而 `secret` 还得带 `role('secret')`，否则它的值会随表单响应回到浏览器；
 *   - 其余连接参数仍有默认值，且保持不可编辑（不 volatile）。
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Volatile } from '@deepseek-ai/cordis'
import { Config } from '../src/config.js'

/**
 * 按 cordis 的方式解析一份配置（校验 + 填默认值）。
 *
 * Schema 的静态签名要求传完整的 `Config`，而这里正是要验证「不填时解析出什么」，
 * 所以把调用收宽——运行期行为与签名无关（cordis 内部也是这么调的）。
 */
const resolve = Config as unknown as (config: Record<string, unknown>) => Record<string, unknown>

/** schema 节点的元信息：用来断言 volatile / secret 这些只影响 UI 与线缆的声明。 */
const nodes = (Config as unknown as { dict: Record<string, { meta: Record<string, unknown> }> }).dict

/** 取一个 volatile 字段当前的值。 */
function valueOf(resolved: Record<string, unknown>, field: string): unknown {
  return (resolved[field] as Volatile<unknown>).get()
}

describe('企微通道配置', () => {
  test('maxContentBytes 默认为 20480（replyStream 的文档上限）', () => {
    assert.equal(valueOf(resolve({ botId: 'b', secret: 's' }), 'maxContentBytes'), 20_480)
  })

  test('凭证与字节预算都是 volatile 引用：配置页改完由 loader 就地更新，插件不重挂', () => {
    const resolved = resolve({ botId: 'b', secret: 's' })
    assert.equal(valueOf(resolved, 'botId'), 'b')
    assert.equal(valueOf(resolved, 'secret'), 's')
    assert.equal(valueOf(resolved, 'maxContentBytes'), 20_480)
    for (const field of ['botId', 'secret', 'maxContentBytes']) {
      assert.equal(nodes[field]?.meta.volatile, true, `${field} 该能在配置页里就地改`)
    }
    assert.equal(nodes.maxContentBytes?.meta.min, 4)
  })

  test('字节预算不接受 ≤3：省略号自己就 3 字节，再小的预算会把整条消息截空', () => {
    for (const value of [3, 2, 1, 0, -1]) {
      assert.throws(
        () => resolve({ botId: 'b', secret: 's', maxContentBytes: value }),
        `maxContentBytes=${value} 该被 schema 拒掉`,
      )
    }
    assert.equal(valueOf(resolve({ botId: 'b', secret: 's', maxContentBytes: 4 }), 'maxContentBytes'), 4)
  })

  test('缺凭证能解析（不是校验错误）：插件照常挂载，通道保持空闲等页面填', () => {
    const resolved = resolve({})
    assert.equal(valueOf(resolved, 'botId'), undefined)
    assert.equal(valueOf(resolved, 'secret'), undefined)
  })

  test('secret 带 role(secret)：它的值不随表单响应回到浏览器', () => {
    assert.equal(nodes.secret?.meta.role, 'secret')
  })

  test('其余连接参数仍有默认值，且不 volatile（页面只编辑凭证与字节预算）', () => {
    const resolved = resolve({})
    assert.equal(resolved.heartbeatInterval, 30_000)
    assert.equal(resolved.connectTimeoutMs, 15_000)
    for (const field of ['scene', 'plugVersion', 'wsUrl']) {
      assert.notEqual(nodes[field]?.meta.volatile, true, `${field} 不该能被页面就地改`)
    }
  })
})
