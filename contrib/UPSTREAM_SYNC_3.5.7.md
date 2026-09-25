# v3.5.7 上游贡献核对与定制版合并记录

核对日期：2026-09-25。账号：`YunQue0912`。

本次从已经发布的定制版本创建独立工作树，合并原作者的最新正式标签。结果是本地源码候选；
没有推送分支、创建远端标签或 Release，也没有升级服务器或操作生产数据库。

## 基线

| 项目 | 核对结果 |
| --- | --- |
| 已发布定制版 | [v3.5.1-custom.1](https://github.com/YunQue0912/mailflow/releases/tag/v3.5.1-custom.1) |
| 定制发布分支 | `origin/custom/release`，`d361d21bcafa4d84489d9241ebf9e9c10bcc5532` |
| 原作者共同基线 | `v3.5.1`，`8371dbb0f8495db9193e76feab67533f8d8ac96b` |
| 本次合入 | [v3.5.7](https://github.com/maathimself/mailflow/releases/tag/v3.5.7)，`9e45a6f106ca4ced1c6a8f918ab5caace1e1ee51` |
| 上游发布时间 | 2026-09-24 20:53:52 UTC，即北京时间 2026-09-25 04:53:52 |
| 合并前历史差距 | 定制分支独有 59 个提交；最新正式版独有 61 个提交 |
| 本地同步分支 | `custom/sync-3.5.7` |
| 本地工作树 | `F:/program/mail-flow/release/mailflow-sync-3.5.7` |
| 候选应用版本 | `3.5.7-custom.1`；Android `versionCode=305070001` |

`contribution/mailflow-pr` 检出的仍是旧贡献分支，`upstream/mailflow` 也是早期工作树；它们都不是
当前定制发布版本。本次采用远端定制发布分支作为基线，原有工作树保持原状。

核对时 `upstream/main` 在正式版之后还有 `e11e8e4`（葡萄牙语布局及特殊文件夹翻译）。本次严格
合并 `v3.5.7`，未纳入该未随此标签发布的提交。网页搜索缓存一度只显示 v3.5.2，最终版本以
GitHub Releases API 和新拉取的正式标签交叉确认。

## 原作者采用了哪些贡献

### PR #319：邮件服务器地址故障切换

[PR #319](https://github.com/maathimself/mailflow/pull/319) 于 2026-07-29 正式合并，提交为
[`05cb1b0`](https://github.com/maathimself/mailflow/commit/05cb1b096ad924b87ab3ea55bd5ef2ca11010e44)。
提交作者保留为你的账号，并列出原作者为共同作者。

将该合并提交与 PR 最终 head `80a8f51` 比较，后端内容没有差异。采纳范围包括：

- 保存所有已验证的 A/AAAA 地址，继续保持 DNS 重绑定防护。
- IMAP 使用已验证地址回退，同时保留原始主机名的 TLS SNI/证书校验。
- 用户邮件、系统邮件、邀请、密码重置和 SMTP 验证复用统一的 SMTP transport。
- SMTP 连接及 greeting 分阶段限时，并限制整个地址回退预算。
- 只在投递前的 `CONN` 失败时尝试下一地址，避免已经投递的邮件重复发送。
- 相应的地址验证、IMAP 和 SMTP 回归测试。

后续上游保留了故障切换核心，在 `smtpTransport.js` 上增加了：

| 提交 | 后续变化 |
| --- | --- |
| `0d2173a` / #327 | 收件规则转发；增加账户级 SMTP transport 封装 |
| `412c1bc` / #353 | SMTP 可以使用独立于 IMAP 的用户名和密码 |
| `933f334` | Google OAuth 与 Microsoft OAuth 共用账户级令牌刷新/认证路径 |

这些不是重新实现地址回退。`hostValidation.js` 自 #319 到 v3.5.7 内容未变，SMTP 回退函数也
继续保留；IMAP manager 则因为连接池、限流恢复和同步修复经历了较大重构。

### PR #317：会话阅读窗格

[PR #317](https://github.com/maathimself/mailflow/pull/317) 的 GitHub 状态是 **closed、merged_at=null**。
这不代表贡献没有采用。作者在 2026-09-24 的说明及
[v3.5.3 发布说明](https://github.com/maathimself/mailflow/releases/tag/v3.5.3) 中明确确认采用，
引入提交为 [`2044910`](https://github.com/maathimself/mailflow/commit/2044910bfec22224d6379b26533e48680b784252)，
提交信息列出 `YunQue0912` 为共同作者。

逐文件比较原 PR head `04ad669` 与引入提交的 Git blob：以下 **8 个文件全部完全一致**，不是
仅依据作者文字说明判断。

| 模块 | 被原样采用的文件 | 到 v3.5.7 的变化 |
| --- | --- | --- |
| 会话排序、去重、选择和展开状态 | `conversation.js`、`conversation.test.js` | `57869e3` 将去重键加入账户维度，并增加跨账户副本测试 |
| 会话操作目标选择 | `conversationActions.js`、对应测试 | 与原 PR 一致 |
| 三种显示模式及旧设置迁移 | `conversationMode.js`、对应测试 | 与原 PR 一致 |
| 邮件正文重试 | `messageBody.js`、对应测试 | 与原 PR 一致 |

上述路径均在 `frontend/src/utils/` 下。原作者重写了界面及接线部分：

- 从当时最新版 `MessagePane` 抽取共享正文 frame，供单封和会话阅读共用；未直接采用旧 PR 的正文组件。
- 重建 `ConversationPane`、`ConversationMessageCard` 和 `ReadingPane`。折叠卡片不创建正文 frame；
  展开才请求正文，并缓存已取得的正文。
- 保留 `conversationMode` 为唯一设置来源，派生兼容旧调用方的 `threadedView`。
- `8b64acc` 统一已读处理和回复草稿生成；`6e9d778` 接入深链接/通知打开会话。
- `4bc65a5` 接入整组操作与逐封回复；`4e5aeec` 修复窗格宽度；`ff43a1f` 修复点击同会话中的另一封邮件不能定位的问题。
- v3.5.5 保留两个账户分别收到的邮件副本，并分别处理未读数和撤销；v3.5.7 接入快捷键。

因此，你的会话设计和核心逻辑已进入正式上游；原 PR 的全部 UI、原生客户端和定制发布流程并未整体并入。

## 从当前定制版到新正式版的主要变化

| 正式版本 | 新纳入的变化 |
| --- | --- |
| [v3.5.2](https://github.com/maathimself/mailflow/releases/tag/v3.5.2) | 邮件头按声明字符集解码；避免查看邮件头后破坏已有主题；按共同通信参与者判断主题回退归组；登录会话按最近活动续期；附件风险分级统一、尾点识别及 ZIP 下载前确认 |
| [v3.5.3](https://github.com/maathimself/mailflow/releases/tag/v3.5.3) | 采用会话窗格贡献；IMAP 连接池排队并限制并发；正确识别服务器拒绝原因；密码错误退避；大型邮箱完整性扫描与无法抓取 UID 的处理；富文本工具栏改进；巴西葡萄牙语 |
| [v3.5.4](https://github.com/maathimself/mailflow/releases/tag/v3.5.4) | 辅助 IMAP 连接单独退避；正文预取遇到服务商拒绝后停止；后台工作不再阻塞主同步 |
| [v3.5.5](https://github.com/maathimself/mailflow/releases/tag/v3.5.5) | 统一收件箱及会话保留各账户独立投递；撤销恢复正确账户；会话未读数按账户归属调整 |
| [v3.5.6](https://github.com/maathimself/mailflow/releases/tag/v3.5.6) | Yahoo 使用更少连接并避免拒绝窗口内再次登录；Strato 返回与服务器计数矛盾的 SEARCH 结果时不清空本地缓存 |
| [v3.5.7](https://github.com/maathimself/mailflow/releases/tag/v3.5.7) | INBOX 标记已读/星标复用持久连接；按账户串行写标记；同步成功才重置重试退避；键盘分拣及邮箱切换；33Mail 转发原始发件人与接收别名解析 |

新增迁移 `0057`（修复旧的错误主题归组）、`0058`（不可抓取 UID）、`0059`（转发发件人字段）
与上游逐字一致；本次仅合入代码，没有在真实数据库执行。

## 合并处理与保留的定制差异

Git 初始报告 23 个冲突文件，主要来自双方同时新增会话组件。逐项处理后：

1. 接入上游现行会话窗格、共享正文 frame、快捷键、账户去重和整组操作实现，保留从服务端
   重新取得会话成员再操作的行为。删除被替代的旧 hook 和不再使用的折叠动画 CSS。
2. 将定制版的星标、邮件头、退订、反垃圾标识和 AI 操作抽成 `ConversationMessageExtras`，
   将附件控件抽成 `ConversationAttachments`，接到新卡片，防止换用上游组件后这些功能消失。
3. 单封和会话视图的单附件/ZIP 下载均继续通过 Android 原生下载桥；危险附件及“全部下载”
   都须再次确认。新增尾点危险文件、ZIP 和 Android 桥接回归验证。
4. 保留三种会话模式的一行布局、会话跨文件夹计数及 pane 模式点击数量时打开阅读窗格；
   接入上游派生的 `threadedView`，避免两套状态相互覆盖。
5. 线程 SQL 同时使用账户范围和缺失 Message-ID 时的行 ID 回退；保留会话反垃圾字段及 ZIP
   文件名清理。旧配置校验和 `defaultSender`/`conversationMode` 联合保存测试保留。
6. 会话成员变化时重新获取并保留已展开卡片；星标/已读变化同步到卡片；保留整组已读/未读
   按钮及 GTD 自己的已读策略。自动已读采用上游行为：展开哪封就处理哪封，而不是打开窗格
   就把全部折叠邮件也标记已读。
7. Windows/Electron 更新源、Android 固定签名配置、安全桥接、更新确认、版本比较、附件下载
   和原生发布工作流继续使用 `YunQue0912/mailflow`。原生实现及部署脚本与此前发布基线一致，
   Android 仅更新候选版本号。
8. 独立 Edge Gateway 部署说明、`scripts/mailflow-update.sh`、Fork 关于页和更新面板保留。
   新增 pt-BR 的定制更新界面翻译，并删除已经没有调用方的旧翻译键。
9. 上游全部已有依赖版本均保留。前端额外依赖仅为已有的 `electron-updater` 及其专用传递依赖；
   锁文件根版本元数据更新为正确版本。SMTP transport 对齐上游现行实现及 STARTTLS 要求。

合并后的差异主要仍是原生应用更新/发布、原生下载、部署及上述会话增强。它们不属于上游
v3.5.7 的发行内容，不能用直接覆盖上游源码的方式同步。

## 验证与后续发布边界

验证使用 Node 22.23.2、JDK 21.0.11 和本地 Android SDK。邮件/API 测试使用测试替身，没有连接真实邮箱。

- 后端全量：103 个测试文件、1,801 项测试通过；lint、插件边界和入口语法检查通过。
- 前端：2,317 项测试、lint、生产构建通过；结果在本地验证目录保存。
- Android：`testDebugUnitTest` 与 `lintDebug` 通过；应用自身 24 项 JUnit 测试，0 失败。
  应用 lint 为 0 errors、40 warnings，Capacitor 使用自身已有 lint baseline。
- 上游模块采纳的 8 个 Git blob、依赖版本、原生发布/部署文件和迁移文件完成程序化复核。
- 运行依赖的 high 门槛审计通过；仍有与上游相同的后端 1 个、前端 2 个中危依赖项。
- 生产构建仍有大于 500 kB 的 bundle 提示；Android 仍有已有 Gradle 废弃接口提示。

原始验证日志及 `source-audit.json` 在 `F:/program/mail-flow/release/verification-3.5.7-sync/`。

本次未构建正式签名安装包、未运行远端发布 dry-run、未做 Windows/Android 实机连续升级。
`3.5.7-custom.1` 是源码候选版本，不是已公开 Release。当前公开定制版仍为 `v3.5.1-custom.1`。
发布和生产升级应另按现有发布流程进行，不能把此次本地源码验证视为安装包发布或服务器升级完成。
