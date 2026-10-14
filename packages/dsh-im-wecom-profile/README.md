# 企微全家桶（profile 组合包）

把「即时通讯接缝 + 企业微信通道 + 通知 + `/` 命令」四行一次装进 profile：

```sh
dsh plugin --profile web add @lijcoder/dsh-im-wecom-profile
```

它自己**不含任何代码**——运行时内容就是那份 [`cordis.patch.yml`](cordis.patch.yml)。
`src/` 只有一行 `export {}`，让包有个合法入口。

## 它插哪四行

| row id | 包 | 作用 |
| --- | --- | --- |
| `im` | `@lijcoder/dsh-im` | 接缝：`ctx.im` 通道注册表 |
| `im-wecom` | `@lijcoder/dsh-im-wecom` | 企微 aibot 长连接 |
| `notify` | `@lijcoder/dsh-notify` | 完成 / 授权通知（`channel` 钉成 `wecom`） |
| `im-commands` | `@lijcoder/dsh-im-commands` | `/list`、`/help` |

行序有语义：命令功能挂载时就要在通道上订阅消息，所以通道必须排在它前面。

## ⚠️ 与单装是二选一

这四个包**各自也带 patch**（可以单独装）。本组合包为了能一次配齐，**插的是同样的 row id**。

而 cordis 的 `insert` 是**无条件追加**、不按 id 去重（见
[`vendor/include/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/include/src/index.ts)
的 `applyEntryPatches`）。所以：

> **同一个包，只走一条安装路径。** 既装组合包、又单独装 `dsh-notify`，
> 会得到两个 `notify` 行 → 通知发两遍；`im-wecom` 双份则会让两条长连接互相踢线。

dsh 自己也是这个规矩：`packages/bundle/sdk-minimal` 的文件头写明 *"does not layer over
dsh-base"*，`experimental/inspector` 的本地 overlay 与 `inspector-profile` 也是二选一。

**什么时候该用哪条路：**

| 场景 | 用哪条 |
| --- | --- |
| 只要企微这一套 | 本组合包，一条命令 |
| 要混搭多个平台（企微 + 飞书） | 单独装各包：`dsh plugin add @lijcoder/dsh-im @lijcoder/dsh-im-wecom @lijcoder/dsh-im-feishu @lijcoder/dsh-notify @lijcoder/dsh-im-commands`，并在 profile patch 里给 `notify` 指定 `channel` |
| 只想要通知、不要命令 | 单独装前三个包 |

## 环境变量

与四个单包**同名**，所以从单装切到组合包（或反向）不用改环境变量：

| 变量 | 属于 |
| --- | --- |
| `WECOM_BOT_ID` / `WECOM_BOT_SECRET` | 企微通道（缺则 `im-wecom` 行停用） |
| `DSH_NOTIFY_TARGET` | 通知目标（缺则 `notify` 行停用） |

命令行没有必填配置，默认启用；但**它必须有通道可用**，否则挂载时直接报错
（这是刻意的：静默不响应比报错难查）。

## 验证

```sh
pnpm --filter @lijcoder/dsh-im-wecom-profile test
```

用例把 patch 当**结构**来断言（row id、每行的完整包名、`disabled` 表达式读的是哪几个环境变量），
而不是字符串匹配；并额外面向四个单包断言它们的 row id 集合与本组合包一致——
**那四个 id 的重合是有意的**，这条测试把它钉成明确的事实，而不是靠人记得。
