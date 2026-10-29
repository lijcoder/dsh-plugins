/**
 * 外壳冻结的模块表（dsh 的 `PLATFORM_MODULES`）：这些必须留在 `require()` 里。
 *
 * 打进包里就等于给页面塞了第二份 React、第二份 slot 账本，运行时对不上（而且模块系统
 * 也只会用自己那份）。外壳加一个模块，这里跟着加——构建脚本与产物测试共用这一份清单。
 */
export const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]
