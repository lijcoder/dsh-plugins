/**
 * 配置页的文案。键与 `LocaleNamespaceMap` 里登记的那个 namespace 绑定，
 * 组件拿到的 `t` 因此只认这里列出的键。
 */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** 这个页面用到的全部文案键。 */
export type LocaleKey =
  | 'intro'
  | 'botId' | 'botIdHint'
  | 'secret' | 'secretHint' | 'secretKeep' | 'secretSet' | 'secretUnset'
  | 'maxContentBytes' | 'maxContentBytesHint'
  | 'target' | 'targetHint'
  | 'maxQuestionBytes' | 'maxQuestionBytesHint'
  | 'maxOutputBytes' | 'maxOutputBytesHint'
  | 'unconfigured'
  | 'overridden' | 'reset' | 'invalid'
  | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'

/** 字典 namespace：页面注册时用它绑定 `t`。 */
export const NS = 'plugin.imWecomProfile'

export const zh: Record<LocaleKey, string> = {
  intro: '这里填的值存进当前 profile 的补丁文件，保存后立即生效——企业微信通道会按新凭证重连，不用重启。',
  botId: '机器人 ID',
  botIdHint: '企业微信智能机器人的 ID（aib 开头）。留空则回到 profile 外层给的值（例如环境变量）。',
  secret: '机器人 Secret',
  secretHint: '机器人 Secret。它不会回显，所以每次修改都要重新填一遍；留空保存表示不修改。',
  secretKeep: '已保存的 Secret 不会回显；留空保存表示不修改。',
  secretSet: '已配置',
  secretUnset: '未配置',
  maxContentBytes: '单条消息字节上限',
  maxContentBytesHint: '一张卡片（正文含在内）的 UTF-8 字节兜底上限，默认 20480。企业微信的被动回复（/list、/help）平台上限本来就是 20480 字节，调大它不会让那些回复变长；主动推送没有文档上限。正文要更长，得把问题 / 回复两段预算和它一起调大。',
  target: '通知目标',
  targetHint: '通知发到哪：群聊填 chatid，单聊填 userid。留空则回到 profile 外层给的值。',
  maxQuestionBytes: '「问题」字节预算',
  maxQuestionBytesHint: '「问题」那段的 UTF-8 字节上限，默认 400。中文一个字约 3 字节；整条消息还会被通道的单条消息字节上限（默认 20480）兜底截断，所以要让问题更长，这里的预算和它得一起调大。',
  maxOutputBytes: '「回复」字节预算',
  maxOutputBytesHint: '「回复」那段的 UTF-8 字节上限，默认 2000，约 666 个汉字。整条消息还会被通道的单条消息字节上限（默认 20480）兜底截断，所以要让正文更长，这里的预算和它得一起调大。',
  unconfigured: '凭证还没配齐，企业微信通道不会建连；填好保存后会自动连上。',
  overridden: '已覆盖',
  reset: '恢复默认',
  invalid: '这个值不能用',
  readOnly: '这个部署把设置存成只读。',
  unavailable: '这两行插件当前没有启用，没有可配置的表单。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '没保存成功：可能是值被拒绝，或别处刚改过。请检查后重试。',
}

export const en: Record<LocaleKey, string> = {
  intro: 'Values here are stored in this profile’s patch file and apply immediately — the WeCom channel reconnects with the new credentials, no restart.',
  botId: 'Robot ID',
  botIdHint: 'The WeCom intelligent robot ID (starts with aib). Blank falls back to the value from an outer layer, such as an environment variable.',
  secret: 'Robot secret',
  secretHint: 'The robot secret. It is never echoed back, so every change means typing it again; saving with it blank leaves it untouched.',
  secretKeep: 'The stored secret is never echoed back; saving with this blank leaves it untouched.',
  secretSet: 'Configured',
  secretUnset: 'Not configured',
  maxContentBytes: 'Message byte limit',
  maxContentBytesHint: 'Fallback UTF-8 byte limit for one card, body included; default 20480. WeCom caps passive replies (/list, /help) at 20480 bytes, so raising this does not lengthen those; active pushes have no documented limit. For a longer body, raise this together with the question and reply budgets.',
  target: 'Notification target',
  targetHint: 'Where notifications go: a chatid for a group, a userid for a direct chat. Blank falls back to the value from an outer layer.',
  maxQuestionBytes: '“Question” byte budget',
  maxQuestionBytesHint: 'UTF-8 byte limit for the “Question” section; default 400. A Chinese character is about 3 bytes. The whole message is still cut off by the channel message byte limit (default 20480), so lengthening the question means raising both.',
  maxOutputBytes: '“Reply” byte budget',
  maxOutputBytesHint: 'UTF-8 byte limit for the “Reply” section; default 2000, about 666 Chinese characters. The whole message is still cut off by the channel message byte limit (default 20480), so a longer body means raising both.',
  unconfigured: 'Credentials are incomplete, so the WeCom channel stays disconnected; it connects once you save them.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'This value cannot be used',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'Neither plugin row is enabled right now, so there is no form to configure.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'Not saved: a value may have been refused, or something else changed it. Check and try again.',
}

/** 表单框架要的那几句文案。 */
export function formLabels(t: (key: LocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
