/**
 * 企微全家桶配置页的**浏览器半侧**。
 *
 * 页面挂在「插件 → `@lijcoder/dsh-im-wecom-profile`」这个组合包的详情页上：`plugins.bundle.config`
 * 以组合包的包名做 key，插行、行开关、装/卸都在同一个页面上，配置跟着一起，不用再让人去翻文件。
 *
 * 表单编辑的是组合包插的两行各自的设置 namespace，所以页面只在 Host 服务其中任一 namespace
 * 期间注册（`whileServed`）：没装这套组合、或两行都被停用的部署看不到任何痕迹。
 *
 * `inject` 只声明 Web 组合一定会提供的服务（见 `@deepseek-ai/dsh-web-app` 的花名册）：
 * 缺一个的话 fiber 会一直 PENDING，整个 Web 启动都算失败。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 只为设置镜像里那些线缆类型（namespace 视图、secret 标记）能被命名。
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 只为 `ctx.slots`（slot 账本服务）：它由渲染层提供，类型也从那里并进来。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// 只为把 `ctx.configForms`（以及它背后的设置镜像）并进 Context 类型：跨插件协作走服务，不 import 值。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// 只为把 `plugins.bundle.config` 这个 slot 的类型并进来（纯类型，不进 bundle）。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { ConfigPage } from './ConfigPage.tsx'
import { ConfigPageModel, type ChannelConfig, type NotifyConfig, type SecretPresence } from './config-page.ts'
import { en, NS, zh, type LocaleKey } from './locales.ts'
import { BUNDLE_PACKAGE, CHANNEL_NAMESPACE, NOTIFY_NAMESPACE, SECRET_FIELD } from '../namespaces.ts'

export type { ConfigPageFace, ConfigPageState, SecretPresence } from './config-page.ts'
export type { LocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 企微全家桶配置页的文案。 */
    'plugin.imWecomProfile': LocaleKey
  }
}

/** 需要的服务：slot 账本、字典、以及按 namespace 读写的设置表单。 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * 挂上配置页。
 * @param ctx - 浏览器插件 Context。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-im-wecom-profile: dictionaries')
  ctx.effect(() => ctx.configForms.whileServed([CHANNEL_NAMESPACE, NOTIFY_NAMESPACE], () => {
    const model = new ConfigPageModel(
      ctx.configForms.get<ChannelConfig>(CHANNEL_NAMESPACE),
      ctx.configForms.get<NotifyConfig>(NOTIFY_NAMESPACE),
      secretPresence(ctx),
    )
    const off = ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: BUNDLE_PACKAGE,
      locale: NS,
      inject: () => model.inject(),
    }, ConfigPage))
    return () => {
      off()
      model.dispose()
    }
  }), 'dsh-im-wecom-profile: config page')
}

/**
 * 凭证标记的读面：`role('secret')` 的值被 Host 从表单响应里摘掉，只留一个
 * `secrets: [{ path, set }]` 边车，所以「配没配」要单独从这里读。
 */
function secretPresence(ctx: ClientContext): SecretPresence {
  const describe = ctx.configForms.describe()
  const read = (): boolean => {
    const channel = describe.getSnapshot().view?.namespaces.find(candidate => candidate.ns === CHANNEL_NAMESPACE)
    return channel?.secrets.some(secret => secret.set && secret.path.length === 1 && secret.path[0] === SECRET_FIELD) ?? false
  }
  return { get: read, subscribe: (listener) => describe.subscribe(listener) }
}
