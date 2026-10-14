import { homedir } from 'node:os'

/**
 * 展示文本工具。
 *
 * 放在接缝包里，是因为功能与通道两侧都要用：功能侧按预算决定"放多少内容"、
 * 把路径塞进表格；通道侧按预算兜底截断整条消息、把 `code` 值渲染成行内代码。
 * 两边处理的是同一个概念，实现也就该只有一份。
 */

/** 把 home 目录缩成 `~`，路径短一点更好读。 */
export function shortenCwd(cwd: string, home: string = homedir()): string {
  if (home === '') return cwd
  if (cwd === home) return '~'
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
}

/** UTF-8 字节长度：企微的字节上限算的是字节，不是字符。 */
export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** 按 UTF-8 字节预算截断，不切断码点；截断时补省略号，结果长度永远 ≤ 预算。 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (utf8Length(text) <= maxBytes) return text
  const budget = maxBytes - utf8Length('…')
  if (budget <= 0) return ''
  let used = 0
  let out = ''
  for (const char of text) {
    const bytes = utf8Length(char)
    if (used + bytes > budget) break
    out += char
    used += bytes
  }
  return `${out}…`
}
