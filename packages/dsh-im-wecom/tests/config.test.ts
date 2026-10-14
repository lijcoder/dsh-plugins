/**
 * 通道配置的 schema 测试。
 *
 * 只盯一件事：`maxContentBytes` 的默认值。它是个有出处的数字（SDK 文档写的
 * `replyStream` 上限 20480 字节），被谁悄悄改小都会让长内容被无声截断——
 * 而截断本身不会报错，只有用户觉得"内容怎么少了一截"。
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Config } from '../src/config.js'

/**
 * 按 cordis 的方式解析一份配置（校验 + 填默认值）。
 *
 * Schema 的静态签名要求传完整的 `Config`，而这里正是要验证「只给必填项时默认值是多少」，
 * 所以把调用收宽——运行期行为与签名无关（cordis 内部也是这么调的）。
 */
const resolve = Config as unknown as (config: Record<string, unknown>) => Record<string, unknown>

describe('企微通道配置', () => {
  test('maxContentBytes 默认为 20480（replyStream 的文档上限）', () => {
    assert.equal(resolve({ botId: 'b', secret: 's' }).maxContentBytes, 20_480)
  })

  test('其余连接参数都有默认值，因此只需凭证即可启用', () => {
    const resolved = resolve({ botId: 'b', secret: 's' })
    assert.equal(resolved.botId, 'b')
    assert.equal(resolved.heartbeatInterval, 30_000)
    assert.equal(resolved.connectTimeoutMs, 15_000)
  })
})
