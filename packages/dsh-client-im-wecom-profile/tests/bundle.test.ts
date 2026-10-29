/**
 * 客户端 bundle 的产物形状测试。
 *
 * dsh 的模块系统对产物有硬要求，而**每一种违反都只在浏览器里炸**：头尾不对 -> factory 登记不上，
 * 平台模块被打进包 -> 页面里出现第二份 React / slot 账本，运行时对不上。所以这里把产物当结构断言，
 * 而不是等装进 profile 再靠肉眼发现。
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PLATFORM_MODULES } from '../scripts/platform-modules.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  name: string
  files?: string[]
  exports?: Record<string, { default?: string }>
  dsh?: { client?: { platform?: string; inject?: string[] } }
}
const bundlePath = `${root}/lib/client.js`

describe('客户端 bundle 产物', () => {
  test('构建产物在（缺它时 dsh 会在启动阶段直接报激活失败）', () => {
    assert.ok(existsSync(bundlePath), 'lib/client.js 不存在：先 pnpm build')
  })

  test('是向 window.__ModuleLoader__ 登记的闭包工厂，且返回 module.exports', () => {
    const source = readFileSync(bundlePath, 'utf8')
    assert.ok(
      source.startsWith(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`),
      '头必须以模块加载器的登记语句开头',
    )
    assert.match(source, /var module = \{ exports: \{\} \}; var exports = module\.exports;/)
    assert.match(source, /module\.exports = __toCommonJS\(/)
    // 尾部还有一行 sourceMappingURL 注释，先摘掉再断言闭合。
    const code = source.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '')
    assert.ok(code.endsWith('return module.exports; } });'), '尾必须闭合 factory 并交出 exports')
  })

  test('只 require 平台模块表里的包（其余全部内联）', () => {
    const source = readFileSync(bundlePath, 'utf8')
    const specifiers = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]!)
    assert.ok(specifiers.length > 0, '一个外部依赖都没 require，说明整包被内联了')
    for (const specifier of specifiers) {
      assert.ok(
        PLATFORM_MODULES.includes(specifier),
        `${specifier} 不在平台模块表里：它会被打进 bundle，等于给页面塞第二份`,
      )
    }
  })

  test('manifest 声明了浏览器半侧，且 files 会把产物和行 id 送上 npm', () => {
    assert.equal(manifest.dsh?.client?.platform, 'web')
    assert.equal(manifest.exports?.['./client']?.default, './lib/client.js')
    assert.ok(manifest.files?.includes('lib'), 'files 必须包含 lib')
    // inject 只是信息性的包名依赖（不参与服务注入），但配置页少了 ui-settings 就没表单可用。
    assert.ok(manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings'))
    assert.ok(manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-plugin-manager'))
  })
})
