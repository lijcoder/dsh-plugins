/**
 * 配置页的纯逻辑：字段属于哪一行、字节预算草稿怎么解析、两个表单怎么合成一个保存按钮、凭证算不算齐。
 *
 * 单独一个模块，是为了这些判断能被单测直接跑：`config-page.ts` 必须 import
 * `@deepseek-ai/dsh-client-ui-primitives`，而那个包在 Node 里加载不了——它是给 Vite 用的
 * 静态链接产物（index 里有几十个 CSS module 与 katex / shiki 之类的大依赖树）。
 * 所以这里既不带运行期的 UI 依赖，也不 import 那个包（只有类型，编译期就擦掉了）。
 */

import type { SettingsFieldSpec, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  BOT_ID_FIELD,
  CHANNEL_NAMESPACE,
  MAX_CONTENT_BYTES_FIELD,
  MAX_OUTPUT_BYTES_FIELD,
  MAX_QUESTION_BYTES_FIELD,
  NOTIFY_NAMESPACE,
  SECRET_FIELD,
  TARGET_FIELD,
} from '../namespaces.ts'

/** 页面上的字段：凭证与整条预算属于通道那行，通知目标与两段预算属于通知那行。 */
export type PageField =
  | typeof BOT_ID_FIELD
  | typeof SECRET_FIELD
  | typeof MAX_CONTENT_BYTES_FIELD
  | typeof TARGET_FIELD
  | typeof MAX_QUESTION_BYTES_FIELD
  | typeof MAX_OUTPUT_BYTES_FIELD

/**
 * 字段属于哪一行。写谁只由这张表决定——两行都支持字符串字段，字段名写错不会报错，
 * 只会安静地写进另一行。
 * @param field - 页面上的字段名。
 * @returns 该字段所属的设置 namespace（= profile 条目 id）。
 */
export function namespaceOf(field: PageField): string {
  return field === TARGET_FIELD || field === MAX_QUESTION_BYTES_FIELD || field === MAX_OUTPUT_BYTES_FIELD
    ? NOTIFY_NAMESPACE
    : CHANNEL_NAMESPACE
}

/**
 * 收窄注册面传进来的字段名。
 *
 * slot 的编辑动作收的就是字符串，未声明的名字（比如 JSX 里打错一个字母）如果放过去，
 * 就会静默写到通道那一行——比直接抛错贵得多。
 * @param field - 编辑动作报上来的字段名。
 * @returns 同一个名字，已收窄成页面声明的字段。
 * @throws 页面没有这个字段时。
 */
export function asPageField(field: string): PageField {
  switch (field) {
    case BOT_ID_FIELD:
    case SECRET_FIELD:
    case MAX_CONTENT_BYTES_FIELD:
    case TARGET_FIELD:
    case MAX_QUESTION_BYTES_FIELD:
    case MAX_OUTPUT_BYTES_FIELD:
      return field
    default:
      throw new Error(`配置页没有字段 "${field}"`)
  }
}

/**
 * 字节预算字段的转换规则：只收 ≥4 的整数，空草稿 = 清掉覆盖。
 *
 * 不用 UI 包的 `settingsNumberField`：它在 Node 里加载不了（那个包是给 Vite 的静态链接
 * 产物），而这条规则要能被单测直接跑；而且它对下界没有要求——`truncateUtf8` 的省略号自己
 * 占 3 字节，预算 ≤3 时正文会被截得一个字不剩，那等于把正文静默发没，不如在这里拦住保存。
 * @param field - namespace 段里的字段名（逐字就是宿主 schema 的键名）。
 * @returns 该字段的转换规则。
 */
export function bytesField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isInteger(parsed) && parsed >= 4 ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/**
 * 凭证是否齐了（齐了才会建连）。
 *
 * 凭证的值不会回到浏览器，所以「配没配」有两个来源：已存密钥的标记，
 * 以及用户这次刚敲进输入框、还没保存的草稿。
 * @param input - 机器人 ID 的草稿、secret 的草稿，以及 Host 报告的已配置标记。
 * @returns 现在这份配置能不能连上。
 */
export function channelReady(input: { botId: string; secret: string; secretConfigured: boolean }): boolean {
  return input.botId.trim() !== '' && (input.secretConfigured || input.secret.trim() !== '')
}

/**
 * 把两个表单的状态合成一个保存按钮的状态。
 *
 * 页面只有一个保存按钮，所以「能不能点」「有没有改动」「上次成没成功」都得按两边一起算：
 * 任一边有待写改动就该能点，任一边无效或失败就整体不通过。
 * @param channel - 通道那行表单的状态。
 * @param notify - 通知那行表单的状态。
 * @returns 合成后的表单壳状态。
 */
export function mergeShell(channel: SettingsFormShell, notify: SettingsFormShell): SettingsFormShell {
  return {
    // 两行分属两个 namespace：任一被服务就先渲染，缺的那条由表单自己说明。
    available: channel.available || notify.available,
    writable: channel.writable && notify.writable,
    dirty: channel.dirty || notify.dirty,
    invalid: channel.invalid || notify.invalid,
    saving: channel.saving || notify.saving,
    failed: channel.failed || notify.failed,
  }
}
