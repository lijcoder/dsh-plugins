/**
 * 这个页面编辑的 profile 条目 id。
 *
 * 它们同时是**设置里的 namespace 名**（设置按 profile 条目 id 定位表单），所以必须与
 * `@lijcoder/dsh-im-wecom-profile` 的 `cordis.patch.yml` 里的 row id 一模一样：
 * 客户端包不 import 宿主包，拼写对不上只会在运行时表现为「页面永远显示不可用」。
 * 组合包的 patch 测试断言这两组名字相等，把这条跨包约定钉住。
 */

/** 企微通道那一行：`botId` / `secret` 在这里编辑。 */
export const CHANNEL_NAMESPACE = 'im-wecom'

/** 通知那一行：`target` 在这里编辑。 */
export const NOTIFY_NAMESPACE = 'notify'

/** 通知行里这个页面编辑的字段。 */
export const TARGET_FIELD = 'target'

/** 通道行里这个页面编辑的字段。 */
export const BOT_ID_FIELD = 'botId'

/**
 * 凭证字段名。它的值不回浏览器，所以「配没配」这个标记（设置镜像的 secrets 边车）
 * 与写入面都点这个名字。
 */
export const SECRET_FIELD = 'secret'

/** 通道行的整条消息字节兜底，同时也是宿主 schema 的键名。 */
export const MAX_CONTENT_BYTES_FIELD = 'maxContentBytes'

/** 通知行「问题」段的字节预算，同时也是宿主 schema 的键名。 */
export const MAX_QUESTION_BYTES_FIELD = 'maxQuestionBytes'

/** 通知行「回复」段的字节预算，同时也是宿主 schema 的键名。 */
export const MAX_OUTPUT_BYTES_FIELD = 'maxOutputBytes'

/** 配置页挂在哪个组合包的详情页上（`plugins.bundle.config` 以包名为 key）。 */
export const BUNDLE_PACKAGE = '@lijcoder/dsh-im-wecom-profile'
