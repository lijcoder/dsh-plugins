# @lijcoder/dsh-plugin-testkit

编写 DeepSeek Harness 插件测试的共享工具。

## 为什么要有它

插件的集成测试应该挂在**真实的 cordis Context** 上：

```ts
const h = createTestContext()
h.provide('agents', { roots: () => [] })
h.provide('sessionProjections', { stateOf: () => undefined })
await h.mount(MyPlugin, config)
emitAgentStatus(h.ctx, agent, 'idle')
await h.dispose()
```

手搓一个「长得像 Context」的替身对象更省事，但它会绕过注入解析、`ctx.effect` 清理和
事件分发。于是「插件少声明了一个 `inject`，运行时才炸」这类缺陷在测试里完全看不见——
本仓库就真的踩过一次（`/list` 读 `ctx.agents` 没声明 inject）。

## 提供什么

| 导出 | 用途 |
| --- | --- |
| `createTestContext()` | 真实 Context + 日志捕获 + 统一 `dispose()`；`mount()` 挂插件并等注入满足 |
| `LogRecorder` | 日志替身，可直接当 `ctx.logger` 用，或用 `captureLogs(ctx)` 接到真实 Context 上 |
| `session` / `topLevel` / `subagent` / `fakeAgent` | dsh 会话与 agent 夹具 |
| `userMessageEvent` / `assistantMessageEvent` / `turnStartEvent` / `turnEndEvent` / `titleEvent` | 事件流夹具 |
| `emitSessionEvent` / `emitAgentStatus` / `requestApproval` | 按 dsh 真实分发模式触发事件 |
| `parsePatch` / `insertedEntries` / `entryById` / `jsExpr` | 把 `cordis.patch.yml` 当**结构**解析与断言 |

`requestApproval` 特别说明：`approval/request` 在 dsh 里是 **waterfall**，不是普通事件，
所以它用 `ctx.waterfall` 触发并返回最终决策，而不是 `ctx.emit`。

## 约定

- 夹具只构造被测代码真正会读的字段。字段不够用时**在这里补**，不要在各自的插件测试里
  再造一份——重复的夹具会各自漂移，最后没人知道哪份是真的。
- 只放**两个以上插件**确实用得上的东西。插件私有的替身（例如某个具体通道的假客户端）
  留在那个插件自己的 `tests/` 里。

## 已知限制

- `exports` 直接指向 `src/index.ts`（TS 源码），靠 `tsx` 在测试时转译，因此**没有构建步骤**、
  不需要「先 build 再 test」的隐式顺序。代价是它目前**不能作为 JS 包发布**：
  真要发布，得补一个 `tsc` 构建把 `exports` 切到 `lib/`。
  它只是各插件的 `devDependencies`，用户的安装树里不会出现它。
