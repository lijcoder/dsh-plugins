/**
 * profile 组合包的 patch 结构测试。
 *
 * 断言的是**结构**而不是字符串：row id、每行指向的完整包名、环境变量读的是哪几个。
 * 原因是这类错误全都静默——行的 `name` 写错时启动器只打一句警告就丢弃该行，
 * profile 照常起来，功能没了。
 *
 * 另外两条跨包约定也在这里钉住，它们同样只有运行时才炸：
 *   - 配置页包（浏览器半侧）必须**占一条行**，否则页面到不了浏览器；
 *   - 页面按 namespace 找的那两个 row id，必须与 patch 里插的 id 逐字相同。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BUNDLE_PACKAGE,
  CHANNEL_NAMESPACE,
  NOTIFY_NAMESPACE,
} from '@lijcoder/dsh-client-im-wecom-profile'
import { entryById, insertedEntries, jsExpr, parsePatch } from '@lijcoder/dsh-plugin-testkit'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  name: string
  files?: string[]
  exports?: Record<string, string>
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}
const patches = parsePatch(readFileSync(`${root}/cordis.patch.yml`, 'utf8'))

/** 期望插的五条行，顺序即加载顺序。 */
const EXPECTED = [
  { id: 'im', name: '@lijcoder/dsh-im' },
  { id: 'im-wecom', name: '@lijcoder/dsh-im-wecom' },
  { id: 'notify', name: '@lijcoder/dsh-notify' },
  { id: 'im-commands', name: '@lijcoder/dsh-im-commands' },
  { id: 'im-wecom-config-ui', name: '@lijcoder/dsh-client-im-wecom-profile' },
]

/** 配置页那一行指向的包：浏览器半侧，另有几条约定要断言。 */
const UI_PACKAGE = '@lijcoder/dsh-client-im-wecom-profile'

describe('企微全家桶 combo patch', () => {
  test('恰好插入五行，且顺序是「接缝 → 通道 → 功能 → 配置页」', () => {
    assert.deepEqual(
      insertedEntries(patches).map((entry) => ({ id: entry.id, name: entry.name })),
      EXPECTED,
    )
  })

  test('每行的 name 是完整包名（写错会被启动器静默丢弃）', () => {
    for (const expected of EXPECTED) {
      assert.equal(entryById(insertedEntries(patches), expected.id)?.name, expected.name)
    }
  })

  test('没有一行靠缺配置停用：停用的行在设置里不存在，凭证就没地方填', () => {
    for (const entry of insertedEntries(patches)) {
      assert.equal(
        entry.disabled,
        undefined,
        `row ${entry.id} 不该有 disabled 闸门：设置只暴露活着的条目，缺凭证要靠配置页补`,
      )
    }
  })

  test('环境变量名不以 DSH_ 等保留前缀开头（否则写进 .env 会让 dsh 直接报错退出）', () => {
    for (const entry of insertedEntries(patches)) {
      const names = [jsExpr(entry.disabled), ...Object.values(entry.config ?? {}).map(jsExpr)]
      for (const expression of names) {
        if (expression === undefined) continue
        for (const match of expression.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
          assert.doesNotMatch(
            match[1]!,
            /^(DSH_|XDG_|DYLD_|BASH_FUNC_)/,
            `${match[1]} 是启动器保留名，只能 export，不能写进 .env`,
          )
        }
      }
    }
  })

  test('凭证与通知目标以环境变量作为组合层默认值，通道被钉成 wecom', () => {
    const inserted = insertedEntries(patches)
    assert.equal(jsExpr(entryById(inserted, 'im-wecom')?.config?.botId), 'process.env.WECOM_BOT_ID')
    assert.equal(jsExpr(entryById(inserted, 'im-wecom')?.config?.secret), 'process.env.WECOM_BOT_SECRET')
    assert.equal(jsExpr(entryById(inserted, 'notify')?.config?.target), 'process.env.IM_NOTIFY_TARGET')
    assert.equal(entryById(inserted, 'notify')?.config?.channel, 'wecom')
    assert.equal(entryById(inserted, 'im-commands')?.config?.channel, 'wecom')
  })
})

describe('企微全家桶打包与依赖', () => {
  test('声明 dsh.bundle 并把 patch 带进 files / exports（否则装上去不生效）', () => {
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.ok(manifest.files?.includes('cordis.patch.yml'), 'files 必须包含 cordis.patch.yml')
    assert.equal(manifest.exports?.['./cordis.patch.yml'], './cordis.patch.yml')
  })

  test('五个成员包都是 dependencies，且它们自己不带 patch', () => {
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), EXPECTED.map((e) => e.name).sort())
    for (const { name } of EXPECTED) {
      const member = require(`${name}/package.json`) as { dsh?: { bundle?: unknown } }
      assert.equal(
        member.dsh?.bundle,
        undefined,
        `${name} 不该带 dsh.bundle：成员一旦可单装，与组合包同时装就会让插件挂载两次`,
      )
    }
  })

  test('配置页包声明了 dsh.client，且 exports["./client"] 指向已构建的 bundle', () => {
    const ui = require(`${UI_PACKAGE}/package.json`) as {
      files?: string[]
      exports?: Record<string, unknown>
      dsh?: { client?: { platform?: string } }
    }
    assert.equal(ui.dsh?.client?.platform, 'web')
    const client = ui.exports?.['./client'] as { default?: string } | undefined
    assert.equal(client?.default, './lib/client.js')
    assert.ok(ui.files?.includes('lib'), 'files 必须包含 lib，否则装上去浏览器半侧不存在')
    assert.ok(
      existsSync(`${root}/../dsh-client-im-wecom-profile/lib/client.js`),
      '客户端 bundle 还没构建：缺它时 dsh 会在启动阶段直接报激活失败（先 pnpm build）',
    )
  })

  test('配置页盯着的 namespace 就是 patch 里插的 row id，页面挂的是本组合包', () => {
    const inserted = insertedEntries(patches)
    assert.equal(BUNDLE_PACKAGE, manifest.name, '页面的 plugins.bundle.config key 必须是本组合包的包名')
    assert.ok(entryById(inserted, CHANNEL_NAMESPACE), `页面要配的 ${CHANNEL_NAMESPACE} 行不存在`)
    assert.ok(entryById(inserted, NOTIFY_NAMESPACE), `页面要配的 ${NOTIFY_NAMESPACE} 行不存在`)
  })
})
