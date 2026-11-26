# 从 4.3.0-custom.2 升级至 4.5.1 定制版

适用于 `/opt/mailflow` 的独立 Edge Gateway 部署。4.4 起前端在同一容器内运行 Caddy，登录会话和短期状态移到 PostgreSQL。首次升级到 4.5.1 会执行迁移 `0076–0081`，用户需重新登录一次，已有纯 HTML 邮件的全文索引随后在后台重建。先在隔离的 PostgreSQL 恢复副本演练迁移，正式切换使用核验过的精确版本镜像。

## 准备生产 Compose

在改动前备份当前 `docker-compose.yml`、`docker-compose.override.yml`、`.env` 以及现有 PostgreSQL。保留 Redis 卷直至回退窗口结束。用当前生产配置做候选副本并原位合入以下变更，保留 Edge gateway、`mailflow-ingress:80`、`mailflow_internal` 与 `edge_mailflow`、backend 固定 IP、PostgreSQL 卷和现有密钥。仓库通用 Compose 包含端口发布，适用于独立部署。

| 位置 | 生产配置变更 |
| --- | --- |
| `frontend.environment` | 传入 `TLS_MODE: "off"`。独立 Edge Gateway 继续终结 HTTPS，Caddy 在容器内监听 HTTP `:80`。 |
| `frontend.healthcheck.test` | 使用 `["CMD-SHELL", "wget -qO/dev/null http://127.0.0.1:2080/healthz \|\| exit 1"]`。这个端口仅供容器内健康检查。 |
| `frontend.ports` | 继续通过内网别名接入 Edge，保持宿主机端口未发布。 |
| `backend` | 保留 `stop_grace_period: 30s` 和现有迁移启动宽限，保留 Microsoft 和 Google OAuth 环境变量。移除 `REDIS_URL` 和 `depends_on.redis`。 |
| `postgres` | 沿用现有数据库、用户和卷。更新器备份的是生产 `mailflow` 库。若单独引入 `DATABASE_URL`，先建立对应实际数据库的备份与回退流程。 |
| `redis`、旧 `caddy` | 从 MailFlow Compose 服务中移除 Redis 和其中曾定义的旧独立 Caddy（如有）。独立 Edge Gateway 继续由自己的项目管理。 |
| `docker-compose.override.yml` | 三个公开目录继续以相同源路径只读挂载，将容器目标分别改为 `/srv/about`、`/srv/privacy`、`/srv/terms`。旧的 `nginx -t` 页面安装器适用于 4.3 前端。 |

保留 Edge 传入的 `X-Forwarded-Proto: https`，按实际隔离后的代理链核对 `TRUST_PROXY_HOPS`。同时保留原有 `APP_URL` 和登录回调地址。除非已有独立数据库迁移计划，生产本次使用既有 `DB_*`。`SESSION_IDLE_DAYS` 是可选设置，通过 Compose 传入才会生效。

## 执行切换

1. 在服务器本地合并并渲染候选 Compose。显式包含生产正在使用的公开页面 override，检查 Edge 别名、应用精确镜像、网络、PostgreSQL 卷和挂载目标。只在服务器本地查看渲染后的 JSON，里面可能含密钥。
2. 核验已发布的定制镜像后，安装本仓库 `scripts/mailflow-update.sh` 到现有 `/usr/local/sbin/mailflow-update`。部署候选 Compose 文件，保持当前 `.env` 的 `MAILFLOW_VERSION`，使用更新器指定新版本。配置替换与容器重建之间避免运行其他 `docker compose up` 命令。
3. 更新器检查生产入口配置、确认旧容器健康、校验数据库备份并保存当前工作配置。拉取目标精确镜像成功后才更换 `.env` 的版本，再依次重建 backend 和 frontend。backend 通过健康检查后才重建 frontend。首次切换应按隔离演练结果配置 `MAILFLOW_UPDATE_WAIT_SECONDS`。
4. 核对 `/api/health`、`/api/version`、Web 登录及 Secure Cookie、OAuth／SSO、WebSocket 重连、AI SSE 和三个公开页面的实际 HTML。记录页面正文，区分应用本身的 SPA 回退。确认迁移 `0076–0081` 和在后台执行的索引回填。完成验证后可安排退役仍在运行的旧 MailFlow Redis 容器，保留回退窗口内所需的卷。

## 重试与回退

镜像拉取失败时，`.env` 仍指向原版本，确认旧服务健康后可重试。若进入容器重建后超时，保留升级前备份，在服务器上检查两个容器的精确镜像、健康状态和 backend 迁移日志。迁移仍在运行时等待其完成。若目标 backend 已健康而 frontend 尚未完成切换，先核对当前 `.env` 固定为目标版本以及两个 Compose 文件，再以 `docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps frontend` 单独重试 frontend，随后完成上述验收。两个容器及公网健康端点恢复后，也可以用同一精确版本重新执行更新器核验。

升级后的数据库已包含新 schema。4.4 或更高版本的 backend 正在运行时，更新器会拒绝直接换回 4.3 或更早的镜像。需要回退时，使用改动前的 Compose、override、精确版本镜像和 PostgreSQL 备份，并评估切换后产生的数据。

上游说明：[4.4.0 会话与 Caddy 切换](https://github.com/maathimself/mailflow/releases/tag/v4.4.0)、[4.5.0 数据库与索引迁移](https://github.com/maathimself/mailflow/releases/tag/v4.5.0)、[4.5.1 修复版本](https://github.com/maathimself/mailflow/releases/tag/v4.5.1)。
