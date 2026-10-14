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

### 可替换能力：接缝 / 实现 / 功能 / 组合包

一个「有多个实现方」的能力分四层，照 dsh 自己的 `ctx.llm` / `ctx.browserUse` 来：

| 层 | 职责 | 例子 |
| --- | --- | --- |
| 接缝 | 定义契约、Context key 与注册表；**不含任何实现** | `dsh-im`（`ctx.im`） |
| 实现 | 实现契约的一个具体平台/机制，注册进接缝 | `dsh-im-wecom` |
| 功能 | 只依赖接缝，产出中立数据结构，不关心实现是谁 | `dsh-notify`、`dsh-im-commands` |
| 组合包 | 自己不含代码，只有 `cordis.patch.yml`，一行装齐 | `dsh-notify-wecom` |

两条硬规矩：

- Context key 用**单数**（`ctx.im`），注册表方法收**具名成员**（`registerChannel('wecom', …)`）。
  消费方按名字取；只有一个成员时可以不指名，多个必须指名——静默选错比报错贵得多。
- **渲染归实现，内容归功能**。功能产出结构（`ImDocument`），排版与平台限制由实现处理。
  能力用声明表达（`capabilities.tables`），实现自己降级；不要写成 `if (platform === 'wecom')`。

组合包必须关心**行序**：需要接缝 → 实现 → 功能。功能若在挂载时就要订阅（如命令功能
必须先在通道上 `onMessage`），实现行必须排在它前面，否则启动期报错。

### 构建顺序

包之间靠 `lib/*.d.ts` 解析类型（`exports` 指向 `lib/`，因为要被 dsh 加载器按包名加载），
所以 **`pnpm check` 是先 build 再 typecheck**。单独跑 `pnpm typecheck` 前要先 `pnpm build`。
dsh 主仓库的 `typecheck` 也是先 build 再查，这不是特例。

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
| 纯函数单测 | `tests/*.test.ts` | 直接调 `renderDocument`、`parseCommand`、`notificationDocument` 这类函数，不涉及 cordis |
| 集成 | 同上 | **`@lijcoder/dsh-plugin-testkit` 的真实 cordis Context** + 假的通道/服务替身 |
| 组合 e2e | 组合包的 `tests/` | 多个包挂在同一个真实 Context 上，对着本地 Mock 服务端断言用户看到的帧 |

**没有「手搓 Context 直接戳事件处理器」这一层。** 试过，代价是漏掉了真缺陷：
手搓替身绕过注入解析、`ctx.effect` 清理和事件分发，于是「插件少声明 inject」
「忘了释放连接」这类问题在单测里完全看不见。真实 Context 的测试要覆盖：

1. 插件能挂载（inject 能满足），且少一个服务时保持 PENDING；
2. 真实事件分发能把插件驱动到产生外部可观察的结果（发帧、写文件……）；
3. `dispose()` 之后外部资源确实关掉了。

外部协议（企微长连接之类）用一个本地 Mock 服务端测，见
`packages/dsh-notify-wecom/tests/mock-wecom.ts`：不需要凭证、不联外网、能断言每一帧。
Mock 的 `close()` 必须 `terminate()` 掉还连着的客户端，否则用例失败没跑到 dispose 时，
整个测试进程会卡在 `wss.close()` 上。

组合层要单独测：**单包各自绿不代表拼起来能跑通**——行序、通道注册、inject 满足、
渲染串起来，只有组合 e2e 能验证。

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
- 重复三次再抽象。共享的东西只放**已被两个以上包实际使用**的（`@lijcoder/dsh-im`
  里的 `truncateUtf8` / `shortenCwd` 就是这么来的），否则 kit 会退化成垃圾场。
- 先有第二个实现方，再抽象接缝。但**一旦确认会有多个实现方就要一次做对**——
  `ctx.im` 的分层就是为「以后接飞书」付出的成本，事后补要改所有功能包。

## 新增一个插件

1. `mkdir packages/<name>`，照现有包的 `package.json` / `tsconfig.json` 抄一份；
2. `dsh.bundle.patch` 指向自己的 `cordis.patch.yml`，row 的 `name` 写**完整包名**；
3. 在根 README 的插件表里加一行；
4. `pnpm install && pnpm check`；
5. 装进隔离 profile，`--dump-config` 确认那一层在。
