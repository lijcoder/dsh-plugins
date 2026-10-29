/**
 * 通知配置的 schema 测试。
 *
 * 盯两件「错了不会报错」的事：
 *   - 两个字节预算必须是 **volatile**：这是它们能在 Web 插件页里改的前提
 *     （改完 loader 只就地更新引用、不重挂插件，所以 `notify.ts` 发送时现读）；
 *   - 下界是 4 字节：`truncateUtf8` 的省略号自己占 3 字节，更小的预算会把那段正文
 *     截得一个字不剩（≤0 更是直接返回空串），报错比静默发空消息便宜。
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

/** schema 节点的元信息：用来断言 volatile / min 这些只影响 UI 与线缆的声明。 */
const nodes = (Config as unknown as { dict: Record<string, { meta: Record<string, unknown> }> }).dict

/** 取一个 volatile 字段当前的值。 */
function valueOf(resolved: Record<string, unknown>, field: string): unknown {
  return (resolved[field] as Volatile<unknown>).get()
}

describe('通知配置', () => {
  test('两个字节预算默认 400 / 2000，且是 volatile 引用（页面才改得动）', () => {
    const resolved = resolve({})
    assert.equal(valueOf(resolved, 'maxQuestionBytes'), 400)
    assert.equal(valueOf(resolved, 'maxOutputBytes'), 2_000)
    assert.equal(nodes.maxQuestionBytes?.meta.volatile, true)
    assert.equal(nodes.maxOutputBytes?.meta.volatile, true)
  })

  test('预算下界是 4：更小的值被 schema 拒掉，而不是静默把正文截空', () => {
    for (const value of [3, 1, 0, -1]) {
      assert.throws(() => resolve({ maxQuestionBytes: value }), `maxQuestionBytes=${value} 该被拒`)
      assert.throws(() => resolve({ maxOutputBytes: value }), `maxOutputBytes=${value} 该被拒`)
    }
    assert.equal(valueOf(resolve({ maxOutputBytes: 4 }), 'maxOutputBytes'), 4)
  })

  test('其余字段仍有默认值，且不 volatile（页面只编辑目标与两个预算）', () => {
    const resolved = resolve({})
    assert.equal(resolved.heading, 'DSH 任务通知')
    assert.equal(resolved.approvalHeading, 'DSH 授权通知')
    assert.equal(resolved.questionHeading, 'DSH 提问通知')
    assert.equal(resolved.includeApprovals, true)
    assert.equal(resolved.includeQuestions, true)
    for (const field of ['heading', 'approvalHeading', 'questionHeading', 'includeApprovals', 'includeQuestions', 'onlyCompleted', 'dryRun']) {
      assert.notEqual(nodes[field]?.meta.volatile, true, `${field} 不该能被页面就地改`)
    }
  })
})
