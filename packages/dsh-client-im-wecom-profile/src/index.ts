/**
 * 企微全家桶配置页的**宿主半侧**：空的 `apply`，只为让这个包在 profile 里占一条 Loader 行。
 *
 * 客户端模块系统只给「name 恰好是裸包名」的行挂浏览器半侧（`exports["./client"]`），
 * 所以没有这条行，页面根本到不了浏览器。真正的 UI 在 `src/client/`。
 */

// 这些名字是客户端页面与组合包 patch 之间的约定，宿主半侧一并转出去，好让 patch 测试断言它们相等。
export {
  BOT_ID_FIELD,
  BUNDLE_PACKAGE,
  CHANNEL_NAMESPACE,
  NOTIFY_NAMESPACE,
  SECRET_FIELD,
  TARGET_FIELD,
} from './namespaces.js'

/** Cordis 插件名，同时是诊断日志里的标识。 */
export const name = 'dsh-client-im-wecom-profile'

/** 宿主侧无事可做：配置页是浏览器半侧的事。 */
export function apply(): void {}
