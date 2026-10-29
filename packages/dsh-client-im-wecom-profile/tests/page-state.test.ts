/**
 * 配置页纯逻辑的测试。
 *
 * 这些判断值钱的地方在于**错了不会报错**：字段写进另一行照样保存成功，只是写错了地方；
 * 凭证齐不齐算错只会让人以为配好了却连不上。至于「草稿怎么暂存、什么时候写」是 dsh
 * 表单模型（`@deepseek-ai/dsh-client-ui-primitives`）的契约，不在我们这里断言——那个包是
 * Vite 用的静态链接产物，Node 里加载不了。
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { asPageField, bytesField, channelReady, mergeShell, namespaceOf } from '../src/client/page-state.js'
import {
  BOT_ID_FIELD,
  CHANNEL_NAMESPACE,
  MAX_CONTENT_BYTES_FIELD,
  MAX_OUTPUT_BYTES_FIELD,
  MAX_QUESTION_BYTES_FIELD,
  NOTIFY_NAMESPACE,
  SECRET_FIELD,
  TARGET_FIELD,
} from '../src/namespaces.js'

/** 一份表单壳状态，默认「可用、可写、无改动」。 */
function shell(overrides: Partial<SettingsFormShell> = {}): SettingsFormShell {
  return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false, ...overrides }
}

describe('字段归属', () => {
  test('凭证与整条消息预算写通道那行，通知目标与两段预算写通知那行', () => {
    assert.equal(namespaceOf(BOT_ID_FIELD), CHANNEL_NAMESPACE)
    assert.equal(namespaceOf(SECRET_FIELD), CHANNEL_NAMESPACE)
    assert.equal(namespaceOf(MAX_CONTENT_BYTES_FIELD), CHANNEL_NAMESPACE)
    assert.equal(namespaceOf(TARGET_FIELD), NOTIFY_NAMESPACE)
    assert.equal(namespaceOf(MAX_QUESTION_BYTES_FIELD), NOTIFY_NAMESPACE)
    assert.equal(namespaceOf(MAX_OUTPUT_BYTES_FIELD), NOTIFY_NAMESPACE)
  })

  test('namespace 名就是 patch 里的 row id', () => {
    assert.equal(CHANNEL_NAMESPACE, 'im-wecom')
    assert.equal(NOTIFY_NAMESPACE, 'notify')
  })

  test('六个字段都收，没声明过的名字照样抛（打错一个字母就会静默写进另一行）', () => {
    for (const field of [BOT_ID_FIELD, SECRET_FIELD, MAX_CONTENT_BYTES_FIELD, TARGET_FIELD, MAX_QUESTION_BYTES_FIELD, MAX_OUTPUT_BYTES_FIELD]) {
      assert.equal(asPageField(field), field)
    }
    assert.throws(() => asPageField('maxOutputByte'), /配置页没有字段/)
  })
})

describe('字节预算草稿', () => {
  const spec = bytesField(MAX_OUTPUT_BYTES_FIELD)

  test('字段名原样带过去：它就是宿主 schema 的键名', () => {
    assert.equal(spec.field, MAX_OUTPUT_BYTES_FIELD)
  })

  test('有值就显示数字，没有就空着（空草稿的含义由清空那条用例定）', () => {
    assert.equal(spec.format(2000), '2000')
    assert.equal(spec.format(undefined), '')
  })

  test('空草稿（含只有空白）= 清掉覆盖，回落到组合层', () => {
    assert.deepEqual(spec.parse(''), { kind: 'clear' })
    assert.deepEqual(spec.parse('   '), { kind: 'clear' })
  })

  test('≥4 的整数草稿写成数字，前后空白不影响', () => {
    assert.deepEqual(spec.parse(' 20480 '), { kind: 'set', value: 20480 })
    assert.deepEqual(spec.parse('4'), { kind: 'set', value: 4 })
  })

  test('≤3 / 小数 / 非数字 / Infinity 都不接受，表单据此拦住保存', () => {
    // ≤3 也要拦住：truncateUtf8 的省略号自己占 3 字节，存进去等于静默把正文发没。
    for (const text of ['3', '2', '1', '0', '-1', '1.5', 'abc', 'Infinity']) {
      assert.equal(spec.parse(text), undefined, `"${text}" 不该被接受`)
    }
  })
})

describe('凭证齐不齐', () => {
  test('只有 ID、也没存过 secret：不算齐（这时候连不上）', () => {
    assert.equal(channelReady({ botId: 'bot-1', secret: '', secretConfigured: false }), false)
  })

  test('存过 secret 但值不回显：标记在就算齐', () => {
    assert.equal(channelReady({ botId: 'bot-1', secret: '', secretConfigured: true }), true)
  })

  test('这次刚敲进去还没保存的 secret 也算数', () => {
    assert.equal(channelReady({ botId: 'bot-1', secret: 's3cret', secretConfigured: false }), true)
  })

  test('ID 空着就不算齐，secret 再全也没用', () => {
    assert.equal(channelReady({ botId: '  ', secret: 's3cret', secretConfigured: true }), false)
  })
})

describe('两个表单合成一个保存按钮', () => {
  test('任一被服务就先渲染，任一不可写就整体不可写', () => {
    const merged = mergeShell(shell({ available: true }), shell({ available: false, writable: false }))
    assert.equal(merged.available, true)
    assert.equal(merged.writable, false)
  })

  test('任一有待写改动就该能点保存', () => {
    assert.equal(mergeShell(shell(), shell({ dirty: true })).dirty, true)
    assert.equal(mergeShell(shell({ dirty: true }), shell()).dirty, true)
    assert.equal(mergeShell(shell(), shell()).dirty, false)
  })

  test('无效 / 保存中 / 上次失败都按两边一起算', () => {
    assert.equal(mergeShell(shell({ invalid: true }), shell()).invalid, true)
    assert.equal(mergeShell(shell(), shell({ invalid: true })).invalid, true)
    assert.equal(mergeShell(shell(), shell({ saving: true })).saving, true)
    assert.equal(mergeShell(shell({ failed: true }), shell()).failed, true)
  })
})
