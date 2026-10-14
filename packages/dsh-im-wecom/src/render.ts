import type { ImCapabilities, ImDocument, ImFact } from '@lijcoder/dsh-im'
import { shortenCwd, truncateUtf8 } from '@lijcoder/dsh-im'

export { shortenCwd, truncateUtf8, utf8Length } from '@lijcoder/dsh-im'

/**
 * 把平台中立的 {@link ImDocument} 渲染成企微 markdown。
 *
 * 实测这条通道支持：`##` 标题、`**加粗**`、`` `行内代码` ``、`>` 引用块；
 * **不支持** `<font color>`（会原样打出）、表格、代码块。所以：
 * - 状态只用 emoji 表达（颜色写不出来）；
 * - 元信息放进引用块；
 * - 表格由 {@link renderTable} 降级成「加粗首列 + 引用块」，而不是把 `| … |` 原样打出去。
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
  if (document.table !== undefined && document.table.rows.length > 0) {
    blocks.push(renderTable(document.table, style))
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
 * 渲染表格。
 *
 * 声明支持表格的通道用标准 markdown 表格；不支持的降级成
 * 「加粗首列 + 引用块」，比原样吐出 `| … |` 可读得多。
 */
function renderTable(table: NonNullable<ImDocument['table']>, style: Style): string {
  if (style.tables) {
    const head = `| ${table.columns.join(' | ')} |`
    const divider = `| ${table.columns.map(() => '---').join(' | ')} |`
    const rows = table.rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
    return [head, divider, ...rows].join('\n')
  }
  // 首列当小标题，其余列在引用块里逐项列出；首列为空表示与上一行同组，不再重复打标题。
  const rest = table.columns.slice(1)
  return table.rows.map((row) => {
    const [lead, ...others] = row
    const detail = rest
      .map((column, index) => `${column}：${cell(others[index] ?? '')}`)
      .join(' · ')
    const head = lead === undefined || lead === '' ? '' : style.bold(cell(lead))
    if (detail === '') return head
    const quote = style.quote(detail)
    return head === '' ? quote : `${head}\n${quote}`
  }).filter((block) => block !== '').join('\n\n')
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
