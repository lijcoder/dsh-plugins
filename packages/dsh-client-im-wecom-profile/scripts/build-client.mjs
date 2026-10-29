/**
 * 把浏览器半侧打成 dsh 客户端模块系统认的 bundle。
 *
 * dsh 的 `clientBundle` 预设没随包发布（它只活在 dsh 仓库里，还会 glob 自己的 `packages/*`），
 * 所以仓库外的包要自己复刻这一步。要复刻的只有三件事，但**必须逐字一致**：
 *
 *   1. 产物是「闭包工厂」而不是模块：向 `window.__ModuleLoader__` 登记一个 factory，
 *      模块体（含副作用）等物化时才跑；
 *   2. 平台模块表里的包留成 `require()`（见 platform-modules.mjs）；
 *   3. 其余相对 import 一律内联。所以别在这个包里用 `import()` 拆 chunk：
 *      同级 chunk 走的是同步 require，拿不到。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { PLATFORM_MODULES } from './platform-modules.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  external: PLATFORM_MODULES,
  // esbuild 的 JS API 只有 banner/footer（`intro`/`outro` 是 CLI 的），所以工厂的开场两行
  // 一起放进 banner：登记 factory，然后在它内部造出 CJS 的 module/exports。
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
