import * as yaml from 'js-yaml'

/**
 * cordis patch 文件（`cordis.patch.yml`）的结构化解析。
 *
 * 为什么要专门做这件事：我们的 patch 里带 `!!js` 自定义标签，用普通 YAML 解析器
 * 直接读会抛「unknown tag」。而 patch 的内容——row id、行的 `name`、`disabled`
 * 表达式——恰恰是最容易出错又最难发现的地方：**行的 `name` 写错时启动器只会打一句
 * 警告就丢弃该行**，profile 照常起来，功能静默消失。所以它值得被测试断言，而不是靠人眼看。
 *
 * 标签的定义与 dsh 的 `@deepseek-ai/cordis-plugin-include` 保持一致，
 * 这样测试断言的就是加载器真正解析出来的东西。
 */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  represent: (data) => (data as { __jsExpr: string }).__jsExpr,
})

/** 与加载器同源的 YAML dialect。 */
export const PATCH_SCHEMA = yaml.JSON_SCHEMA.extend(JsExpr)

/** patch 文件里的一行。 */
export interface PatchEntry {
  readonly id?: string
  readonly name?: string
  /** `!!js` 表达式被解析成 `{ __jsExpr: '…' }`；字面量保持原样。 */
  readonly disabled?: unknown
  readonly config?: Record<string, unknown>
  readonly insert?: readonly PatchEntry[]
}

/** `!!js` 表达式的源码文本；不是表达式时返回 undefined。 */
export function jsExpr(value: unknown): string | undefined {
  const record = value as { __jsExpr?: unknown } | null
  return typeof record?.__jsExpr === 'string' ? record.__jsExpr : undefined
}

/**
 * 解析一份 patch 文本。
 *
 * @param text - `cordis.patch.yml` 的内容。
 * @returns patch 行数组（顶层）。
 * @throws 顶层不是数组时。
 */
export function parsePatch(text: string): PatchEntry[] {
  const parsed = yaml.load(text, { schema: PATCH_SCHEMA })
  if (!Array.isArray(parsed)) {
    throw new Error('cordis.patch.yml 的顶层必须是数组')
  }
  return parsed as PatchEntry[]
}

/** 取所有被 `insert:` 的行（忽略只做覆盖的裸行）。 */
export function insertedEntries(patches: readonly PatchEntry[]): PatchEntry[] {
  return patches.flatMap((patch) => patch.insert ?? [])
}

/** 按 id 找一行。 */
export function entryById(patches: readonly PatchEntry[], id: string): PatchEntry | undefined {
  return patches.find((patch) => patch.id === id)
}
