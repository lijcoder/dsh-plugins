import type { ImCapabilities, ImDocument, ImFact, ImTable } from '@lijcoder/dsh-im'
import { shortenCwd, truncateUtf8 } from '@lijcoder/dsh-im'

export { shortenCwd, truncateUtf8, utf8Length } from '@lijcoder/dsh-im'

/**
 * 把平台中立的 {@link ImDocument} 渲染成企微 markdown。
 *
 * 实测这条通道支持：`##` 标题、`**加粗**`、`` `行内代码` ``、`>` 引用块、
 * **标准 markdown 表格**；**不支持** `<font color>`（会原样打出）。所以：
 * - 状态只用 emoji 表达（颜色写不出来）；
 * - 元信息放进引用块；
 * - 表格走 {@link renderTable} 的表格分支，表标题（如工作目录）单独占一行加粗；
 *   声明 `tables: false` 的通道才降级成「加粗表标题 + 逐行引用块」。
 *
 * 渲染是通道的职责：功能层只说"要一张三列表"，怎么摆由这里决定。
 */
export function renderDocument(document: ImDocument, capabilities: ImCapabilities): string {
  const style = createStyle(capabilities)
  const blocks: string[] = []

  if (document.heading !== undefined && document.heading !== '') {
    blocks.push(style.heading(document.heading))
  }
  const facts = renderFacts(document.facts, style)
  if (facts !== '') blocks.push(facts)
  for (const section of document.sections ?? []) {
    const body = section.body.trim()
    if (body === '') continue
    blocks.push(`${style.bold(section.title)}\n${body}`)
  }
  for (const table of document.tables ?? []) {
    if (table.rows.length === 0) continue
    const title = table.title?.trim() ?? ''
    if (title !== '') blocks.push(style.bold(title))
    blocks.push(renderTable(table, style))
  }
  if (document.footer !== undefined && document.footer !== '') blocks.push(document.footer)

  return truncateUtf8(blocks.join('\n\n'), capabilities.maxContentBytes)
}

/** 按键值行渲染引用块；没有任何一行时返回空串。 */
function renderFacts(facts: readonly ImFact[] | undefined, style: Style): string {
  const lines: string[] = []
  for (const fact of facts ?? []) {
    if (fact.value === '') continue
    lines.push(style.quote(`${style.bold(`${fact.label}`)}：${style.value(fact)}`))
  }
  return lines.join('\n')
}

/**
 * 渲染一张表（标题由调用方另起一块，这里只管表体）。
 *
 * 声明支持表格的通道用标准 markdown 表格；不支持的降级成逐行引用块，
 * 比原样吐出 `| … |` 可读得多。
 */
function renderTable(table: ImTable, style: Style): string {
  if (style.tables) {
    const head = `| ${table.columns.join(' | ')} |`
    const divider = `| ${table.columns.map(() => '---').join(' | ')} |`
    const rows = table.rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
    return [head, divider, ...rows].join('\n')
  }
  return table.rows.map((row) => style.quote(
    table.columns.map((column, index) => `${column}：${cell(row[index] ?? '')}`).join(' · '),
  )).join('\n')
}

/** 表格单元格：内容可能带竖线或换行，会撑坏表格。 */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

interface Style {
  readonly bold: (text: string) => string
  readonly heading: (text: string) => string
  readonly quote: (text: string) => string
  readonly tables: boolean
  readonly value: (fact: ImFact) => string
}

/**
 * 把能力声明翻译成排版函数。
 *
 * `richText: false` 的通道（纯文本类）拿到的就是没有标记符号的版本——
 * 契约里声明了的能力就得真的兑现，否则消费方没法依赖它。
 */
function createStyle(capabilities: ImCapabilities): Style {
  const mark = (token: string) => (text: string): string => (
    capabilities.richText ? `${token}${text}${token}` : text
  )
  return {
    bold: mark('**'),
    heading: (text) => (capabilities.richText ? `## ${text}` : text),
    quote: (text) => (capabilities.richText ? `> ${text}` : `  ${text}`),
    tables: capabilities.tables,
    value: (fact) => {
      if (fact.code !== true) return fact.value
      // code 值按「路径 / 标识符」对待：home 目录缩写后更短更好读。
      return capabilities.richText ? `\`${shortenCwd(fact.value)}\`` : shortenCwd(fact.value)
    },
  }
}
