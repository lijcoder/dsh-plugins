# @lijcoder/dsh-plugin-testkit

## 概要

写 DeepSeek Harness 插件测试的共享工具：真实 cordis Context 的挂载夹具、日志捕获、dsh 会话与事件夹具、`cordis.patch.yml` 的结构解析。

它只是各插件的 `devDependencies`，不装进用户的安装树，也不是插件（没有 `apply`，不注册任何东西）。

## 目录

- [使用](#使用)
- [了解实现](#了解实现)
- [延伸阅读](#延伸阅读)
- [已知限制与待办](#已知限制与待办)

## 使用

挂插件、驱动事件、断言外部可观察的结果：

```ts
import { createTestContext, fakeAgent, topLevel, emitAgentStatus } from '@lijcoder/dsh-plugin-testkit'

const h = createTestContext()
h.provide('agents', { roots: () => [] })
h.provide('sessionProjections', { stateOf: () => undefined })
await h.mount(MyPlugin, config)          // 等注入满足
emitAgentStatus(h.ctx, agent, 'idle')    // 走真实事件分发
await h.dispose()                        // 等完全停稳
```

`mount()` 返回后插件不一定已激活：注入不满足时 fiber 停在 PENDING（`fiber.state === 0`），`apply` 不执行。所以「少声明 inject」会在用例里表现为什么都没发生，而不是等到运行时才炸。

下列是全部导出（`src/index.ts` 为准）：

| 导出 | 用途 |
| --- | --- |
| `createTestContext()` | 真实 Context + 日志捕获 + 统一 `dispose()`；`mount()` 挂插件并等注入满足 |
| `LogRecorder` / `captureLogs(ctx)` | 日志替身：前者可直接当 `ctx.logger` 用，后者接到真实 Context 上 |
| `session` / `topLevel` / `subagent` / `fakeAgent` | dsh 会话与 agent 夹具 |
| `event` | 自定义会话事件夹具（类型 + 数据 + 时间） |
| `userMessageEvent` / `injectedMessageEvent` / `assistantMessageEvent` | 消息事件夹具 |
| `turnStartEvent` / `turnEndEvent` / `titleEvent` | 回合与标题事件夹具 |
| `emitSessionEvent` / `emitAgentStatus` / `requestApproval` | 按 dsh 真实分发模式触发事件 |
| `parsePatch` / `insertedEntries` / `entryById` / `jsExpr` / `PATCH_SCHEMA` | 把 `cordis.patch.yml` 当结构解析与断言 |

## 了解实现

<details>
<summary>实现细节（维护者向）——点开</summary>

为什么是真实 Context 而不是手搓替身，见 [AGENTS.md](../../AGENTS.md) 的「测试」：替身会绕过注入解析、`ctx.effect` 清理和事件分发，于是缺陷在单测里完全看不见。

`requestApproval` 特别说明：`approval/request` 在 dsh 里是 waterfall，不是普通事件，所以它用 `ctx.waterfall` 触发并返回最终决策，而不是 `ctx.emit`。

夹具的约定：只构造被测代码真正会读的字段，字段不够用时在这里补，不要在各自的插件测试里再造一份——重复的夹具会各自漂移，最后没人知道哪份是真的。只放两个以上插件确实用得上的东西，插件私有的替身（例如某个具体通道的假客户端）留在那个插件自己的 `tests/` 里。

</details>

## 延伸阅读

- 测试分层与真实 Context 的必测项：[AGENTS.md](../../AGENTS.md)
- 通道包的跨包 e2e 与 Mock 服务端：[`@lijcoder/dsh-im-wecom`](../dsh-im-wecom)
- patch 结构断言：[`@lijcoder/dsh-im-wecom-profile`](../dsh-im-wecom-profile)

## 已知限制与待办

- `exports` 直接指向 `src/index.ts`（TS 源码），靠 `tsx` 在测试时转译，因此没有构建步骤，也没有「先 build 再 test」的隐式顺序。代价是它目前不能作为 JS 包发布：真要发布得补一个 `tsc` 构建，把 `exports` 切到 `lib/`。
- 夹具只覆盖本仓库用到的事件与投影；新事件要按需补，没有「全量 dsh 事件」的野心。
