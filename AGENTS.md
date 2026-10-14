# 仓库约定

给在本仓库写插件的人和 agent。目标是像 dsh 主仓库那样组织代码和文档，但只抄付得起维护成本的那部分。改 `packages/` 之前先读这份文件。

## 布局

```
packages/<npm 包名>/          成员：纯库，一个包 = 一个可发布的库
  package.json                不带 dsh.bundle；peer(宽松) / dev(catalog:)
  src/                        源码
  tests/                      单测与 e2e（`*.test.ts`）
  README.md                   这个包的契约
packages/<npm 包名>-profile/  组合包：唯一安装入口
  package.json                dsh.bundle.patch + 成员当 dependencies
  cordis.patch.yml            插行（row id / 完整包名 / 环境变量开关）
  src/index.ts                只有 export {}
  tests/patch.test.ts         patch 结构断言
packages/dsh-plugin-testkit/  只放「两个以上包真的用得上」的测试工具
```

包目录名 = npm 包名去掉 scope 前缀（保留 `dsh-`），这样 `pnpm --filter` 和目录能对上。

## 分层：接缝 / 实现 / 功能

一个有多个实现方的能力分三层，照 dsh 自己的 `ctx.llm` / `ctx.browserUse` 来：

| 层 | 职责 | 例子 |
| --- | --- | --- |
| 接缝 | 定义契约、Context key 与注册表；不含任何实现 | `dsh-im`（`ctx.im`） |
| 实现 | 实现契约的一个具体平台/机制，注册进接缝 | `dsh-im-wecom` |
| 功能 | 只依赖接缝，产出中立数据结构，不关心实现是谁 | `dsh-notify`、`dsh-im-commands` |

两条硬规矩：

- Context key 用单数（`ctx.im`），注册表方法收具名成员（`registerChannel('wecom', …)`）。消费方按名字取；只有一个成员时可以不指名，多个必须指名——静默选错比报错贵得多。
- 渲染归实现，内容归功能。功能产出结构（`ImDocument`），排版与平台限制由实现处理；能力用声明表达（`capabilities.tables`），实现自己降级，不写成 `if (platform === 'wecom')`。

### 安装入口只能是组合包

成员包一律是纯库，只有组合包插行。依据是 dsh 加载器的三件事（dsh 0.2.1-alpha.2 实测 + 源码）：

1. 激活的单位是 bundle 的 patch，不是包：`dsh plugin add` 一个纯库只把它作为普通依赖装进 profile，打一句 `declares no dsh.bundle` 的警告，不激活任何行；
2. 只 add 一个带 bundle 的包时，它的 bundle 依赖同样不会被激活，所以组合包必须自己插行，不能靠依赖；
3. `insert` 是无条件追加——[`applyEntryPatches`](https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/include/src/index.ts) 里就是 `data.push(...insert)`，不按 id 去重。

第 3 条决定了成员不能各自带 patch：同一个 row id 被插两次就是插件挂载两次，通知发两遍、企微两条长连接互相踢线。组合包的 patch 测试断言成员不带 `dsh.bundle`，从根上排除这个组合。

代价要认：加平台 = 加一个组合包，而不是加一个可单装的插件。这是刻意的——profile 组合包表达的本来就是「一套配置」这个粒度。dsh 自己也只在替代型（`packages/bundle/sdk-minimal` 写明 "does not layer over dsh-base"）与二选一型（`packages/experimental/inspector` 的本地 overlay 对 `inspector-profile`）两种情形下让两个 patch 插同一个 id，绝不当叠加用。

## 文档

照 dsh 的 [文档标准](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/AGENTS.md)分层，一处一条事实：

| 文档 | 放什么 |
| --- | --- |
| 根 `AGENTS.md`（本文件） | 跨包常驻规则。每条 1–3 行，理由只留会改变做法的那一句，细节链接到归属处 |
| 根 `README.md` | 仓库取向：包表、安装、环境变量、开发命令 |
| 成员包 `README.md` | 这个包的契约：概要、用法、配置、实现要点、已知限制 |
| 组合包 `README.md` | 安装路径、插哪几行、覆盖语义、装完能看到什么 |
| 代码注释与 JSDoc | 代码表达不出的契约与理由，不复述代码在做什么 |

- 写当前状态。改了什么、踩过什么坑留在 commit 里——本仓库没有笔记层，所以理由只保留到「换个做法就会出错」为止。
- 不写测试清单与用例数，那会漂移；用例名自己说明覆盖。
- 强调节制：`**` 只留给改变做法的那半句。段落一行，换行交给编辑器。
- 包 README 的「了解实现」用 `<details>` 折叠，首屏留给契约；维护者的补充说明写在那里，不另开一节。

不抄 dsh 的这四件，因为它们各需要一个我们没有的机器：README frontmatter 的 `kind`（由包形态推导 + 门禁校验）、中英双语对（对齐门禁）、Model Experience（模型可见文本的审计）、文档字数预算（`verify-doc-budgets`）。等有了对应门禁再补。

## 环境变量不能用保留前缀

dsh 的 `packages/boot/app-boot/src/index.ts` 里 `BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']`：`.env` 文件里出现这些前缀的变量会让 dsh 直接报错退出，不是忽略。所以插件的环境变量一律避开它们（我们用 `WECOM_BOT_ID`、`IM_NOTIFY_TARGET`）。组合包的 patch 测试断言这条。

## patch 必须被测试断言

`cordis.patch.yml` 的 row id、行的 `name`、`disabled` 表达式全部静默失败：`name` 写错时启动器只打一句警告就丢弃该行，profile 照常起来，功能没了。所以每个带 patch 的包都有一个 `tests/patch.test.ts`，用 testkit 的 `parsePatch()` / `insertedEntries()` / `jsExpr()` 把 patch 当结构断言（解析器与加载器同源，包括 `!!js` 标签）。新增或改名包时先跑它。

## 行序不决定激活顺序：入站走接缝

dsh 的 [`loader`](https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/loader/src/config/entry.ts) 是先 `await import` 模块、再创建 fiber，而且不 await 激活。所以 patch 里的行序只决定谁先开始加载，谁先 import 完谁先激活。

后果是任何在 `apply` 里要求「另一个插件已经跑完了」的功能都会 flaky。因此功能只依赖自己 inject 的服务（接缝一定在，它就是 inject 依赖本身），入站从 `ctx.im.onMessage` 订阅；需要外部资源就订阅或惰性解析，不在挂载期解析通道。

## 插件形态

- 导出 `name` / `inject` / `Config` / `apply`，跟 dsh 主仓库一致。
- 读别的插件提供的服务必须声明 `inject`，否则运行时直接抛 `cannot get property "x" without inject`。反过来，自己 `ctx.provide` 的服务不要 inject——会等自己，死锁。
- 用 `ctx.effect(() => () => ...)` 保证 dispose 达到「完全停稳」而不只是「请求停止」。长连接、定时器、子进程都必须能被 effect 收掉，并且有测试断言收掉了。
- 配置里不要塞真实密钥。`cordis.patch.yml` 用 `!!js process.env.X`，让缺凭证时整行 disabled，而不是让 profile 起不来。

## 事件 vs 状态

优先读状态服务与会话投影（`ctx.sessionProjections.stateOf(...)`、`ctx.agents.roots()`），事件只用来捕获状态迁移。

理由：dsh 的 HMR 是配置层热重载、模块代码重启，插件随时可能在会话进行到一半时挂载。任何「从挂载起累积事件」的逻辑，在挂载晚于事件发生时必然失真。

## 构建顺序

包之间靠 `lib/*.d.ts` 解析类型（`exports` 指向 `lib/`，因为要被 dsh 加载器按包名加载），所以 `pnpm check` 是先 build 再 typecheck。单独跑 `pnpm typecheck` 前要先 `pnpm build`；dsh 主仓库的 typecheck 也是先 build 再查。

## 版本契约

dsh 在 alpha，npm 上 `latest` 还停在 rc 线。

- `peerDependencies` 对 `@deepseek-ai/*` 一律写 `"*"`：运行期不校验 peer 范围，写死 `^0.2.1-alpha.2` 会让另一条 prerelease 线上的用户直接装不上。
- `devDependencies` 用根 catalog（`catalog:dsh`）钉死精确版本，升级 harness 只改 `pnpm-workspace.yaml`。
- `@deepseek-ai/schemastery` 也用 peer：它是配置校验器，`Symbol.for('schemastery')` 是全局注册表符号，多实例也能工作，没必要给用户装第二份。

## 测试

三层，别混：

| 层 | 位置 | 用法 |
| --- | --- | --- |
| 纯函数单测 | `tests/*.test.ts` | 直接调 `renderDocument`、`parseCommand`、`notificationDocument` 这类函数，不涉及 cordis |
| 集成 | 同上 | testkit 的真实 cordis Context + 假的通道/服务替身 |
| 跨包 e2e | 通道包的 `tests/` | 多个包挂在同一个真实 Context 上，对本地 Mock 服务端断言用户真正看到的帧 |

没有「手搓 Context 直接戳事件处理器」这一层：那样的替身绕过注入解析、`ctx.effect` 清理和事件分发，于是「插件少声明 inject」「忘了释放连接」这类缺陷在单测里完全看不见。真实 Context 的用例要覆盖：

1. 插件能挂载（inject 满足），少一个服务时保持 PENDING；
2. 真实事件分发能把插件驱动到产生外部可观察的结果（发帧、写文件……）；
3. `dispose()` 之后外部资源确实关掉了。

外部协议用本地 Mock 服务端测（见 `packages/dsh-im-wecom/tests/mock-wecom.ts`）：不需要凭证、不联外网、能断言每一帧。Mock 的 `close()` 必须 `terminate()` 掉还连着的客户端，否则用例失败没跑到 dispose 时，整个测试进程会卡在 `wss.close()` 上。

跨包层要单独测：单包各自绿不代表拼起来能跑通——通道注册、inject 满足、渲染串起来只有它能验证。它放在通道包的 `tests/`（Mock 协议属于通道），靠 devDependencies 引功能包；profile 组合包是安装期的事，不承担测试。

## 安装与验证

唯一激活路径是 `dsh.bundle` + `dsh plugin add`。只在自己 profile 里手写一行 patch 是不够的：启动器找不到该 bundle 会直接丢掉这行并只打一句警告。

改完包之后：

```sh
pnpm check
dsh plugin --profile <隔离的测试 profile> add ./packages/<pkg>
dsh --profile <测试 profile> --dump-config | grep <row id>
```

不要对着正在用的 profile 跑 `--dump-config`：它会重写该 profile 的 `cordis.yml`。

## 代码风格

- 中文注释与文档；只解释为什么，不复述代码在做什么。
- 不过度防御：没有真实失败路径的分支不写，能抛就让它抛。
- 重复三次再抽象。共享的东西只放已被两个以上包实际使用的（`@lijcoder/dsh-im` 里的 `truncateUtf8` / `shortenCwd` 就是这么来的），否则 kit 会退化成垃圾场。
- 先有第二个实现方再抽象接缝；但一旦确认会有多个实现方就要一次做对——`ctx.im` 的分层就是为「以后接飞书」付出的成本，事后补要改所有功能包。

## 新增一个插件

1. 新能力先定接缝（契约 + `ctx.im` 式注册表），实现与功能都只依赖它；
2. 成员包 `mkdir packages/<name>`，照现有成员的 `package.json` / `tsconfig.json` 抄一份，不要加 `dsh.bundle`；
3. 需要能被安装时，改组合包的 `cordis.patch.yml`：row 的 `name` 写完整包名，缺配置的行用 `!!js` 闸门停用；
4. 根 README 的包表加一行，按上面的文档分层写这个包的 README；
5. `pnpm install && pnpm check`；
6. 装进隔离 profile，`--dump-config` 确认那一层在、且没有重复行。
