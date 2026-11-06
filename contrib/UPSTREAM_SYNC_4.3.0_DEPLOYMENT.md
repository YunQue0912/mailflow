# 从 3.5.9-custom.1 升级至 4.3.0 定制版

这是本地合并后的部署准备说明。源码合并、构建通过不等于已经发布镜像或安装包，也不等于已更新服务器。以下步骤应在新定制版本正式发布并核对产物后执行。版本以实际批准的 `X.Y.Z-custom.N` 为准。

## 保留生产 Edge 配置，只补充需要的字段

生产 `/opt/mailflow/docker-compose.yml` 使用独立 Edge Gateway。继续保留其网络、backend 固定地址、数据库与 Redis 卷、精确的 `ghcr.io/yunque0912/mailflow-*` 镜像引用及加密密钥；不要用仓库通用 Compose 文件覆盖它。详见 [现有网络约定](EDGE_GATEWAY_PRODUCTION.md)。

升级前先备份生产 Compose 与 `.env`。在现有文件的 `services.backend` 中原位补充以下字段；`environment` 若已有这些键，应修改原键，避免重复键。此片段是人工合入示例，不是独立 Compose 文件或额外运行的 overlay。

```yaml
services:
  backend:
    stop_grace_period: 30s
    healthcheck:
      # 其余 test / interval / timeout / retries 保持现有值。
      # 首次升级包含历史邮件线程修复，启动前迁移可能比平时长。
      start_period: 15m
    environment:
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-}
      MS_BUILTIN_APP: ${MS_BUILTIN_APP:-}
      MS_CLIENT_ID: ${MS_CLIENT_ID:-}
      MS_CLIENT_SECRET: ${MS_CLIENT_SECRET:-}
      MS_TENANT_ID: ${MS_TENANT_ID:-}
      MS_REDIRECT_URI: ${MS_REDIRECT_URI:-}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI:-}
```

30 秒停止宽限必须保留：新后端会等待已开始的普通/定时发送结束，强制退出预算为 28 秒。旧 Compose 的 Docker 默认停止期限会提前终止它。更新脚本现在会在任何备份或配置修改前拒绝小于 30 秒或未配置的停止宽限。

OAuth 变量即使写在 `.env`，也必须通过 Compose 转发才能进入 backend；在 Settings → Email providers 保存的设置逐字段优先。`MS_BUILTIN_APP` 控制上游内置个人 Microsoft 应用。不要将现有 Microsoft/Google 应用的密钥或回调地址替换成示例值。

`TRUST_PROXY_HOPS` 必须按真实链路设置，并通过 Compose 转发。当前设计的公网链路为 Edge Gateway → MailFlow frontend nginx → backend，且 frontend/backend 没有可绕过代理的公网入口时，对应 `2`。应用前先核对代理链、端口和转发头；未确认时保持空值，不猜测信任跳数。

前端默认 TLS/端口与网络别名继续遵从现有配置。新 `NGINX_TLS` 开关不是本次 Edge 升级的必改项。

## 检查并安装更新脚本

先在生产部署目录检查渲染结果；确认 frontend 只连接 `mailflow` 与 external `edge_mailflow`，别名为 `mailflow-ingress`，backend 的停止宽限和上述环境变量都已生效：

```bash
cd /opt/mailflow
sudo docker compose config --quiet
sudo docker compose config --format json
```

渲染结果可能包含密钥，应在服务器本地检查。核对完成后，将本次源码中 `scripts/mailflow-update.sh` 安装到既有 `/usr/local/sbin/mailflow-update`，保留 root 所有权和 `0755` 权限。仅更新镜像不会替换服务器上已经安装的脚本。

已发布版本的调用示例：

```bash
sudo env MAILFLOW_UPDATE_WAIT_SECONDS=900 \
  /usr/local/sbin/mailflow-update 4.3.0-custom.1
```

`MAILFLOW_UPDATE_WAIT_SECONDS` 接受 30–86400 秒，默认每阶段 900 秒。脚本先拉取两种应用镜像，只重建 backend，等待其迁移完成并健康后再重建 frontend；初始 `unhealthy` 不会立即中断等待。等待超时会停止后续步骤并给出日志/备份提示，不会自动降级镜像或恢复数据库。大型邮箱应按迁移观测调整该值以及首次启动的 `healthcheck.start_period`。

脚本仍会先检查现有服务健康、稳定网络和停止宽限，使用 `pg_dump -Fc` 备份并检查备份目录，保存旧部署配置，再更新精确的 `MAILFLOW_VERSION`。数据库名和用户目前沿用生产既有 `mailflow`，不适用于另行修改过名称的部署。

## 数据迁移与回退边界

从 3.5.9 而来会依次执行全部尚未应用的迁移，并非只执行 4.3.0 的两项新增迁移。3.5.9-custom.1 是否已经包含 0061 应以实际 `schema_migrations` 为准；本轮另增加 0062–0075。

其中 0068 会扫描并拆分原先仅因发件人/主题相同而错误合并的历史邮件线程，0072 修复已发送邮件的附件标记；耗时取决于数据量。迁移在 HTTP 服务开始前执行，迁移连接不设 SQL 超时，不能把首次暂时没有健康响应等同于迁移失败。可在另一终端查看：

```bash
sudo docker logs --tail 100 -f mailflow-backend
```

不要在迁移进行中反复重启。故障时保留日志、数据库备份和旧配置，按实际失败点处理。

4.1 新增定时发送表，4.3 新增 API token 表及 Gmail 标识列。上游明确说明：4.0.x 不会执行定时邮件，并会拒绝备份未知定时发送表；降级需要先处理待发邮件及额外数据库步骤。从 4.3 回到 3.5.9 也不能只把镜像号改回去。稳妥回退应使用升级前备份、匹配的旧版本和部署配置，并另行评估升级后新增邮件/操作的保留；本说明不执行任何删除表或数据恢复。

## 发布验证

定制原生发布流程继续生成 Windows x64、Android APK/AAB、`latest.yml` 与 `update-manifest.json`。本轮验证阶段加入 PostgreSQL 16 服务及 `MAILFLOW_TEST_DATABASE_URL`，确保上游新增数据库集成测试不因无数据库而被略过，同时执行插件边界检查。Android 必须沿用既有签名证书；保持定制更新来源，不使用上游 APK 覆盖定制安装。

Docker 后端新增的 `sharp` 是原生依赖。当前 Dockerfile 已按目标 amd64/arm64 与 Linux musl 安装对应二进制；不要将 Windows 的 `node_modules` 复制到 Linux 镜像。发布时应分别核对这两种架构的镜像构建，核对 `/api/version` 中的定制版本与提交，以及 Web 登录、WebSocket、附件下载、定时发送和原生更新检查。

参考上游 [4.1.0 升级说明](https://github.com/maathimself/mailflow/releases/tag/v4.1.0) 与 [4.3.0 发布说明](https://github.com/maathimself/mailflow/releases/tag/v4.3.0)。本说明按合并源码撰写，未连接或修改生产服务器。
