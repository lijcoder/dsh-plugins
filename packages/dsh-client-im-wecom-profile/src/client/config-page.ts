/**
 * 配置页的状态：两个 namespace 各自的暂存表单，合成一份页面快照。
 *
 * 为什么是两个表单而不是一个：设置里的写入单位是**一个 profile 条目**——一个 namespace、
 * 一个 revision、一次原子写。凭证与整条消息预算属于通道那行，通知目标与两段正文预算属于
 * 通知那行，两个条目分不开，所以页面按下两个表单分别暂存，保存时依次提交（谁被拒都会体现
 * 在 `failed` 上）。
 *
 * 凭证（`secret`）走的是写入面：`role('secret')` 的值永远不回浏览器，页面只知道它「配没配」，
 * 所以那个输入框永远从空白开始，空白保存 = 不动已存的密钥。
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  BOT_ID_FIELD,
  MAX_CONTENT_BYTES_FIELD,
  MAX_OUTPUT_BYTES_FIELD,
  MAX_QUESTION_BYTES_FIELD,
  NOTIFY_NAMESPACE,
  SECRET_FIELD,
  TARGET_FIELD,
} from '../namespaces.ts'
import { asPageField, bytesField, channelReady, mergeShell, namespaceOf } from './page-state.ts'

/** 通道那一行里这个页面编辑的字段。 */
export interface ChannelConfig {
  botId?: string
  secret?: string
  maxContentBytes?: number
}

/** 通知那一行里这个页面编辑的字段。 */
export interface NotifyConfig {
  target?: string
  maxQuestionBytes?: number
  maxOutputBytes?: number
}

/**
 * 凭证是否已配置。`secret` 的值不回浏览器，只有这个标记回，
 * 所以它单独接一路（设置镜像的 secrets 边车），不进表单值。
 */
export interface SecretPresence {
  get(): boolean
  subscribe(listener: () => void): () => void
}

/** 页面渲染的全部状态。 */
export interface ConfigPageState extends SettingsFormShell {
  botId: SettingsFieldState
  /** 凭证输入框的草稿：永远是用户刚敲进去的那串，没有可回填的值。 */
  secret: SettingsFieldState
  /** 整条消息的字节兜底。 */
  maxContentBytes: SettingsFieldState
  target: SettingsFieldState
  /** 「问题」段的字节预算。 */
  maxQuestionBytes: SettingsFieldState
  /** 「回复」段的字节预算。 */
  maxOutputBytes: SettingsFieldState
  /** Host 报告 `secret` 槽位当前有值。 */
  secretConfigured: boolean
  /** 凭证齐了才会建连；缺的时候页面直说，别让人以为配好了。 */
  channelReady: boolean
}

/** 页面注册进 slot 时注入的读写面。 */
export interface ConfigPageFace extends SettingsFormActions {
  hooks: {
    /** 页面快照，渲染层绑成 `useConfigPage`。 */
    configPage: SnapshotStore<ConfigPageState>
  }
}

/** 把两个 namespace 的表单拼成一个页面。 */
export class ConfigPageModel {
  private readonly channel: SettingsFormModel<ChannelConfig>
  private readonly notify: SettingsFormModel<NotifyConfig>
  private readonly presence: SecretPresence
  private readonly store: SnapshotStore<ConfigPageState>
  private readonly channelActions: SettingsFormActions
  private readonly notifyActions: SettingsFormActions
  private readonly observers: Array<() => void> = []

  /**
   * @param channel - 通道那行的设置表单。
   * @param notify - 通知那行的设置表单。
   * @param presence - 凭证标记的读面与订阅。
   */
  constructor(
    channel: SettingsFormScope<ChannelConfig>,
    notify: SettingsFormScope<NotifyConfig>,
    presence: SecretPresence,
  ) {
    this.channel = new SettingsFormModel(channel, [
      settingsTextField(BOT_ID_FIELD),
      bytesField(MAX_CONTENT_BYTES_FIELD),
    ], [{
      field: SECRET_FIELD,
      // 空草稿由 SettingsFormModel 拦下，所以「留空 = 不修改」是模型给的，不是这里判的。
      write: (text) => channel.mutate([{ op: 'set', path: [SECRET_FIELD], value: text }]),
    }])
    this.notify = new SettingsFormModel(notify, [
      settingsTextField(TARGET_FIELD),
      bytesField(MAX_QUESTION_BYTES_FIELD),
      bytesField(MAX_OUTPUT_BYTES_FIELD),
    ])
    this.presence = presence
    this.channelActions = this.channel.actions()
    this.notifyActions = this.notify.actions()
    // 页面只有一份快照：两个表单的草稿加上凭证标记，任何一处变化都整体重算。
    // 模型的 `bind` 是它唯一的观察面，所以这里各接一条投影写进同一份快照。
    this.store = createSnapshotStore(this.project())
    this.channel.bind(() => { this.publish(); return undefined })
    this.notify.bind(() => { this.publish(); return undefined })
    this.observers.push(presence.subscribe(() => { this.publish() }))
  }

  /**
   * 建注册面：快照 + 编辑动作。
   * @returns 页面 slot 注册时注入的那一份。
   */
  inject(): ConfigPageFace {
    return {
      ...this.actions(),
      hooks: { configPage: this.store },
    }
  }

  /**
   * 依次提交两个表单；任一个没落地都会让页面的 `failed` 亮起来。
   * @returns 两个写入都结束后 settle。
   */
  async save(): Promise<void> {
    // 一个被拒也接着提交另一个：用户按了一次保存，能写的先写下去。
    await this.channel.save()
    await this.notify.save()
  }

  /** 释放两表单的订阅与凭证标记的订阅。 */
  dispose(): void {
    this.channel.dispose()
    this.notify.dispose()
    for (const off of this.observers) off()
  }

  private actions(): SettingsFormActions {
    return {
      edit: (field, text) => { this.owner(field).edit(field, text) },
      resetField: (field) => { this.owner(field).resetField(field) },
      save: () => { void this.save() },
      discard: () => {
        this.channelActions.discard()
        this.notifyActions.discard()
      },
    }
  }

  /** 字段归哪个表单，由它所属的 namespace 决定。 */
  private owner(field: string): SettingsFormActions {
    return namespaceOf(asPageField(field)) === NOTIFY_NAMESPACE ? this.notifyActions : this.channelActions
  }

  private publish(): void {
    this.store.set(this.project())
  }

  private project(): ConfigPageState {
    const botId = this.channel.field(BOT_ID_FIELD)
    const secret = this.channel.field(SECRET_FIELD)
    const secretConfigured = this.presence.get()
    return {
      ...mergeShell(this.channel.shell(), this.notify.shell()),
      botId,
      secret,
      maxContentBytes: this.channel.field(MAX_CONTENT_BYTES_FIELD),
      target: this.notify.field(TARGET_FIELD),
      maxQuestionBytes: this.notify.field(MAX_QUESTION_BYTES_FIELD),
      maxOutputBytes: this.notify.field(MAX_OUTPUT_BYTES_FIELD),
      secretConfigured,
      channelReady: channelReady({ botId: botId.text, secret: secret.text, secretConfigured }),
    }
  }
}
