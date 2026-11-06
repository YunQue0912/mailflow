# MailFlow 上游采用情况与后续改写核对

核对日期：2026-11-06（北京时间）。对象：YunQue0912 在 `maathimself/mailflow` 的贡献；终点为最新正式标签 `v4.3.0`，提交 `1b5dbfdbc32f318ee90d6ec9ed3e0a7556487cbc`。依据 GitHub 公开 PR API、作者评论、正式 Release，以及本地已获取的 Git 对象；本报告不表示已部署或发布任何版本。

## 结论

你的两项公开 PR 都进入了产品，但方式不同：

| 贡献 | GitHub 状态 | 实际采用方式 |
| --- | --- | --- |
| [#319：邮件服务器多地址故障切换](https://github.com/maathimself/mailflow/pull/319) | 已合并，2026-07-29 16:14:52 UTC | 以 [05cb1b09](https://github.com/maathimself/mailflow/commit/05cb1b096ad924b87ab3ea55bd5ef2ca11010e44) 正式进入上游，提交作者为你的 GitHub 身份；作者与其他贡献者随后修正和扩展。 |
| [#317：会话阅读窗格](https://github.com/maathimself/mailflow/pull/317) | PR 本身未合并，2026-09-24 关闭 | 作者通过 [2044910b](https://github.com/maathimself/mailflow/commit/2044910bfec22224d6379b26533e48680b784252) 使用了设计和四组工具/测试，重建界面组件，随 v3.5.3 发布，提交列你为共同作者。 |

作者在 [#317 的说明](https://github.com/maathimself/mailflow/pull/317#issuecomment-5823786737) 和 [v3.5.3 发布记录](https://github.com/maathimself/mailflow/releases/tag/v3.5.3) 明确说明了采用范围。因此应区分“PR 已合并”和“代码经另一提交采用”；不能把 #317 的全部组件说成原样合入。

## #317：哪些文件原样采用

对比 PR head `04ad669082bcb81453d36ddf4593e3a7d2c120a9` 与上游引入提交 `2044910bfec22224d6379b26533e48680b784252` 的 Git blob，以下 8 个文件完全相同。这一核对独立验证了作者的说明。

| 路径（均位于 frontend/src/utils） | 引入时与 PR 一致 | 到 v4.3.0 是否仍相同 |
| --- | --- | --- |
| conversation.js / conversation.test.js | 是 | 后续有修改 |
| conversationActions.js / conversationActions.test.js | 是 | 后续有修改 |
| conversationMode.js / conversationMode.test.js | 是 | 是 |
| messageBody.js / messageBody.test.js | 是 | 是 |

原样采用的内容覆盖会话排序与去重、展开状态、成员变化处理、选择/回退判断、会话动作分组、三种模式兼容，以及邮件正文辅助逻辑。上游界面采用 `ConversationPane`、`ConversationMessageCard`、`ReadingPane` 并复用当时的 `MessagePane`：不会对从未展开的卡片发正文请求、创建 iframe 或正文文档；已取回的正文缓存复用。上游线程接口当时已经跨文件夹返回完整会话，因此没有照搬 PR 中全部后端改造或独立的正文组件。

## #317：后续上游怎样修改

| 变化 | 证据与实际影响 |
| --- | --- |
| 跨账户副本保留 | [57869e31 / #476](https://github.com/maathimself/mailflow/commit/57869e31b51b8e094fe49d1d0aae14c26b6d40b5)，v3.5.5：去重键从 Message-ID 改为 Message-ID + account_id，同一封邮件同时投递给两个已连接账户时保留两份，同账户标签副本仍折叠。 |
| 键盘分拣与导航 | [49a66489 / #483](https://github.com/maathimself/mailflow/commit/49a66489dca3a09b0c0869619521a0c18cc1b8a5)，v3.5.7：会话卡片接入通用键盘动作与帮助。作者评论也明确提及该增量。 |
| 卡片星标、未读、打印、EML | [a2bc63d8 / #521](https://github.com/maathimself/mailflow/commit/a2bc63d8204acfad24b2142473aea1c32bd4ff03)：每封邮件增加操作，整组支持打印；正文打印与单封共用清理与 CSP 逻辑。随后增加卡片 AI 动作。 |
| 草稿/垃圾箱/垃圾邮件保护 | [108ff84e](https://github.com/maathimself/mailflow/commit/108ff84e)、[16244d09](https://github.com/maathimself/mailflow/commit/16244d09)、[ceb745b9 / #720](https://github.com/maathimself/mailflow/commit/ceb745b938ffc35d636e66eaddeb6b5be13b54bf)：整组操作区分草稿，避免顺带永久删除已在垃圾箱中的会话副本；后端 `in_trash` 标记与实际永久删除规则一致。 |
| 按当前行账户限定动作 | [ac9a8d75 / #607](https://github.com/maathimself/mailflow/commit/ac9a8d757b3d7abf901c4ca6018688f42e7e849c)：跨账户副本可同时展示，但单账户视图的动作按该行账户筛选；深链/通知/GTD 的选择来源、缓存和未读同步也调整。整组动作不可退回旧版本实现。 |
| 附件统一 | [dbc99e3d / #634](https://github.com/maathimself/mailflow/commit/dbc99e3dfad63c08ca2060326f056de0eef38bb2)：会话和单封共用 `AttachmentStrip`，统一风险确认、预览和下载；下载错误不再导航走整个应用。 |
| 工具栏统一 | [e440de8b / #650](https://github.com/maathimself/mailflow/commit/e440de8b9f3353c47dea35679ea60bb6a79e8547)：`MessageActions` 统一会话与单封图标、顺序、菜单及触屏操作；加入完整邮件头、Todoist、AI、远程图片加载/允许、退订、已读切换和附件入口。 |
| 阅读与选择继续调整 | 后续包含宽邮件适配、暗色正文、远程图片代理、卡片自动已读防竞态、默认打开本账户最新邮件、AI 回复，以及 v4.2 的 List first 布局；它们改变了旧定制组件依赖的上下文和接口。 |

## #319：原始功能与后续修正

最初采用的是：保留所有预验证 A/AAAA 地址；IMAP 只在固定的已验证地址中回退并保留原始 TLS 主机名；SMTP 统一封装供用户/系统邮件和连接验证使用；连接和 greeting 各设 10 秒、总切换预算 45 秒；按 Nodemailer 的 CONN 错误限制重试。

后续关键变化：

- [734e29f4 / #492](https://github.com/maathimself/mailflow/commit/734e29f4)：EHLO 使用实例公开主机名，可用 SMTP_EHLO_NAME 覆盖，改善严格服务器兼容性。
- [a546b46f](https://github.com/maathimself/mailflow/commit/a546b46f)：不允许明文 SMTP 时必须成功 STARTTLS。
- [b5334759 / #579](https://github.com/maathimself/mailflow/commit/b5334759ed8ef7f667e531660905ece177487bb5)：固定地址 lookup 改为异步回调，避免 IPv6 全部立即失败时在 TLS 初始化期间崩溃。
- [f293f4f2](https://github.com/maathimself/mailflow/commit/f293f4f2) 和 [79d5abdb / #685](https://github.com/maathimself/mailflow/commit/79d5abdba00520099d881e6d46bf3a4339594882)：SMTP 加入事务阶段跟踪，发送 MAIL FROM 后禁止切到另一个地址重发。原来的 CONN 分类并不能证明尚未投递，DATA 后断线也可能标为 CONN，因此旧实现有重复投递风险。该修复覆盖普通发送、规则转发和系统邮件；定时发送另读取阶段判断不确定状态。
- [bfa3c2a1](https://github.com/maathimself/mailflow/commit/bfa3c2a1)、[fa722532](https://github.com/maathimself/mailflow/commit/fa722532)、[67cb5f61](https://github.com/maathimself/mailflow/commit/67cb5f61)：主机校验继续处理特殊 IPv4/IPv6 写法、Unicode/尾点 localhost、系统 hosts 解析等情况。
- 该封装随后支持独立 SMTP 账户密码、Google OAuth、规则转发和定时发送。合并时应保留最新版整个 SMTP/主机校验链，不能重放旧补丁覆盖。

## 对当前定制合并的直接建议

1. 将上述已进入上游的会话能力视为共享基础；不要再次叠加旧 ConversationMessageExtras/ConversationAttachments 以造成双工具栏、双附件或绕过当前安全确认。
2. 在上游共享 MessageActions/AttachmentStrip 上保留确需的 Android 原生下载衔接、定制更新面板和本地差异；动作筛选、草稿/Trash 保护和读取竞态采用新版逻辑。
3. 上游原生发布与更新方案来自其他贡献流程；目前没有公开证据表明上游采用了我们的 electron-updater、自定义 update-manifest 或 Android 固定证书更新链。不能将功能相似解释为来源采用。
4. 本地已有历史报告的比较终点为 v3.5.9，已不代表 v4.3.0。单上游 v3.5.9 → v4.3.0 就有 438 个提交、686 个文件变化（Git diff：新增 105,852 行，删除 8,416 行），包括大量测试；本轮必须按当前代码重新核对。

本报告仅覆盖公开采用和上游源码演进。定制更新器/组件的实际合并结果、验证结果和保留差异应以本轮合并报告为准。
