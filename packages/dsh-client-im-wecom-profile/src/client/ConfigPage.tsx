/**
 * 组合包详情页上的配置表单：企业微信通道的凭证与字节预算 + 通知目标与其两段预算。
 *
 * 六个输入框分属两个 namespace（两行插件），但只有一个保存：保存时依次提交，
 * 页面不会出现两个按钮各存一半。凭证那一栏永远空白——它的值不会回浏览器。
 */

// 只为把 `plugins.bundle.config` 这个 slot 的类型并进来（纯类型，不进 bundle）。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigPageFace } from './config-page.ts'
import { formLabels, NS } from './locales.ts'

/** 渲染层为这个页面绑定的 props。 */
export type ConfigPageProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<typeof NS>
  & InjectFace<ConfigPageFace>

/**
 * 渲染配置表单。
 * @param props - 页面状态、文案与编辑动作。
 * @returns 六个字段加一个保存按钮。
 */
export function ConfigPage(props: ConfigPageProps) {
  const { t } = props
  const state = props.useConfigPage(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      {state.channelReady ? null : <p role="status">{t('unconfigured')}</p>}
      <SettingsValueField
        id="plugin-config-im-wecom-bot-id"
        label={t('botId')}
        hint={t('botIdHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        disabled={disabled}
        {...state.botId}
        onEdit={(text) => { props.edit('botId', text) }}
        onReset={() => { props.resetField('botId') }}
      />
      <SettingsSecretField
        id="plugin-config-im-wecom-secret"
        label={t('secret')}
        hint={t(state.secretConfigured ? 'secretKeep' : 'secretHint')}
        disabled={disabled}
        text={state.secret.text}
        configured={state.secretConfigured}
        stateLabel={t(state.secretConfigured ? 'secretSet' : 'secretUnset')}
        onEdit={(text) => { props.edit('secret', text) }}
      />
      <SettingsValueField
        id="plugin-config-im-wecom-max-content-bytes"
        numeric
        label={t('maxContentBytes')}
        hint={t('maxContentBytesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        disabled={disabled}
        {...state.maxContentBytes}
        onEdit={(text) => { props.edit('maxContentBytes', text) }}
        onReset={() => { props.resetField('maxContentBytes') }}
      />
      <SettingsValueField
        id="plugin-config-im-notify-target"
        label={t('target')}
        hint={t('targetHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        disabled={disabled}
        {...state.target}
        onEdit={(text) => { props.edit('target', text) }}
        onReset={() => { props.resetField('target') }}
      />
      <SettingsValueField
        id="plugin-config-im-notify-max-question-bytes"
        numeric
        label={t('maxQuestionBytes')}
        hint={t('maxQuestionBytesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        disabled={disabled}
        {...state.maxQuestionBytes}
        onEdit={(text) => { props.edit('maxQuestionBytes', text) }}
        onReset={() => { props.resetField('maxQuestionBytes') }}
      />
      <SettingsValueField
        id="plugin-config-im-notify-max-output-bytes"
        numeric
        label={t('maxOutputBytes')}
        hint={t('maxOutputBytesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        disabled={disabled}
        {...state.maxOutputBytes}
        onEdit={(text) => { props.edit('maxOutputBytes', text) }}
        onReset={() => { props.resetField('maxOutputBytes') }}
      />
    </SettingsForm>
  )
}
