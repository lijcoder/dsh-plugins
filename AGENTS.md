# 仓库约定

给在本仓库写插件的人（和 agent）看的。目标是**像 dsh 主仓库那样组织代码，但只抄真正付得起维护成本的那部分**。

## 布局

```
packages/<npm 包名>/          一个插件 = 一个包 = 一个可发布单元
  package.json                dsh.bundle.patch + peer(宽松) / dev(catalog:)
  cordis.patch.yml            该 bundle 的配置层：只 insert，不写真实密钥
  src/                        源码
  tests/                      单测与 e2e（`*.test.ts`）
  README.md                   用法、配置、限制
packages/dsh-plugin-testkit/  只放「两个以上插件真的用得上」的测试工具
```

包目录名 = npm 包名（含 scope 去掉 `@scope/` 前缀后仍保留 `dsh-` 前缀），
这样 `pnpm --filter` 和目录能对上。

## 插件形态

- 导出 `name` / `inject` / `Config` / `apply`，跟 dsh 主仓库一致。
- **读别的插件提供的服务必须声明 `inject`**，否则运行时直接抛
  `cannot get property "x" without inject`。本仓库踩过一次：`/list` 读 `ctx.agents` 没声明 inject。
  反过来，**自己 `ctx.provide` 的服务不要 inject**——会等自己，死锁。
- 用 `ctx.effect(() => () => ...)` 保证 dispose 达到「完全停稳」，不只是「请求停止」。
  长连接、定时器、子进程都必须能被 effect 收掉，并且要有测试断言收掉了。
- 配置里不要塞真实密钥。`cordis.patch.yml` 用 `!!js process.env.X`，让缺凭证时整行 `disabled`，
  而不是让 profile 起不来。

## 事件 vs 状态

优先读状态服务与会话投影（`ctx.sessionProjections.stateOf(...)`、`ctx.agents.roots()`），
事件只用来捕获**状态迁移**。

原因很实际：dsh 的 HMR 是「配置层热重载、模块代码重启」，插件随时可能在会话进行到一半时挂载。
任何「从挂载起累积事件」的逻辑，在挂载晚于事件发生时必然失真——会话标题就是这么错的（拿到用户消息而不是标题）。

## 版本契约

dsh 在 alpha，且 npm 上 `latest` 停在 rc 线。

- `peerDependencies` 对 `@deepseek-ai/*` 一律写 `"*"`。运行期并不校验 peer 范围，
  而写死 `^0.2.1-alpha.2` 会让另一条 prerelease 线上的用户直接装不上。
- `devDependencies` 用根 catalog（`catalog:dsh`）钉死精确版本，升级 harness 只改 `pnpm-workspace.yaml`。
- `@deepseek-ai/schemastery` 也用 peer：它是配置校验器，`Symbol.for('schemastery')` 是全局注册表
  符号，多实例也能工作，但没必要给用户装第二份。

## 测试

分三层，别混：

| 层 | 位置 | 用法 |
| --- | --- | --- |
| 纯函数单测 | `tests/*.test.ts` | 直接调 `renderNotification`、`parseCommand` 这类函数，不涉及 cordis |
| 处理器级单测 | 同上 | 手搓的 `fakeContext` 直接戳某个事件处理器，快、断言精确 |
| 集成 / e2e | 同上 | **`@lijcoder/dsh-plugin-testkit` 的真实 cordis Context** |

第三层不可省。手搓 Context 绕过了注入解析、`ctx.effect` 清理和事件分发，于是
「少声明 inject」「忘了释放连接」这类缺陷在单测里完全看不见。真实 Context 的测试要覆盖：

1. 插件能挂载（inject 能满足），且少一个服务时保持 PENDING；
2. 真实事件分发能把插件驱动到产生外部可观察的结果（发帧、写文件……）；
3. `dispose()` 之后外部资源确实关掉了。

外部协议（企微长连接之类）用一个本地 Mock 服务端测，见
`packages/dsh-notify-wecom/tests/mock-wecom.ts`：不需要凭证、不联外网、能断言每一帧。

## 安装与验证

唯一激活路径是 `dsh.bundle` + `dsh plugin add`。**只在自己 profile 里手写一行 patch 是不够的**：
启动器找不到该 bundle 会直接丢掉这行并只打一句警告（本仓库踩过）。

改完包之后：

```sh
pnpm check
dsh plugin --profile <隔离的测试 profile> add ./packages/<pkg>
dsh --profile <测试 profile> --dump-config | grep <row id>
```

不要对着正在用的 profile 跑 `--dump-config`：它会重写该 profile 的 `cordis.yml`。

## 代码风格

- 中文注释与文档；只解释**为什么**，不复述代码在做什么。
- 不过度防御：没有真实失败路径的分支不写，能抛就让它抛。
- 重复三次再抽象。共享的东西只放**已被两个以上插件实际使用**的，否则 kit 会退化成垃圾场。
- 一个能力只有一个消费者时不要提前拆包。企微那条连接将来会被「通知 / 命令 / 消息驱动会话」共用，
  等第二个消费者出现再拆成 seam + provider，现在保持 `wecom.ts`（provider）与
  其余（consumer）的分层即可。

## 新增一个插件

1. `mkdir packages/<name>`，照现有包的 `package.json` / `tsconfig.json` 抄一份；
2. `dsh.bundle.patch` 指向自己的 `cordis.patch.yml`，row 的 `name` 写**完整包名**；
3. 在根 README 的插件表里加一行；
4. `pnpm install && pnpm check`；
5. 装进隔离 profile，`--dump-config` 确认那一层在。
