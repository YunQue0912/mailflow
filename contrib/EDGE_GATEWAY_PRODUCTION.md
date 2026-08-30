# MailFlow 独立 Edge Gateway 稳定态接入

## 适用范围

本说明只适用于当前 `/opt/mailflow` 生产 Compose。仓库通用 `docker-compose.yml`、GHCR 快速安装
Compose 和 Caddy 部署保持通用，不得直接覆盖服务器专用文件。

生产基线：

- frontend 镜像使用已批准的精确 `X.Y.Z-custom.N` 版本。
- frontend 不映射宿主机端口。
- `mailflow` 对应 `mailflow_internal`。
- `edge_mailflow` 是 external 网络，frontend 的网络别名是 `mailflow-ingress`。
- backend 在 `mailflow_internal` 中的固定地址、PostgreSQL、Redis 和现有卷保持不变。
- MailFlow 不加入 ProjectFlow 的内部网络。

## 稳定态配置

服务器 `/opt/mailflow/docker-compose.yml` 中 frontend 必须保持：

```yaml
services:
  frontend:
    networks:
      mailflow:
      edge_mailflow:
        aliases:
          - mailflow-ingress

networks:
  mailflow:
    name: mailflow_internal
    driver: bridge
    # 原有 ipam/subnet 保持不变。
  edge_mailflow:
    name: edge_mailflow
    external: true
```

保留 `mailflow` 网络的原有 subnet、backend 固定地址、卷、镜像和环境变量。服务器发布始终只使用
base `docker-compose.yml`；不要叠加其他 Compose 文件，也不要用仓库通用 Compose 覆盖生产文件。

## 配置验证

```bash
sudo /usr/bin/docker compose \
  --project-directory /opt/mailflow \
  --env-file /opt/mailflow/.env \
  -f /opt/mailflow/docker-compose.yml \
  config --quiet

sudo /usr/bin/docker compose \
  --project-directory /opt/mailflow \
  --env-file /opt/mailflow/.env \
  -f /opt/mailflow/docker-compose.yml \
  config --format json
```

渲染结果中 frontend 只能连接 `mailflow` 与 `edge_mailflow`，并包含别名
`mailflow-ingress`。变更网络后只重建 frontend：

```bash
sudo /usr/bin/docker compose \
  --project-directory /opt/mailflow \
  --env-file /opt/mailflow/.env \
  -f /opt/mailflow/docker-compose.yml \
  up -d --no-deps frontend
```

## 更新脚本约束

`mailflow-update` 只操作 base `docker-compose.yml`。脚本在更新镜像和备份数据库前会检查：

- Compose 已声明 `edge_mailflow`；
- frontend 存在 `mailflow-ingress` 别名；
- 渲染配置中没有 ProjectFlow 内部网络引用。

检查失败时先修复服务器 production Compose，不要绕过检查。

## 验收

```bash
curl -fsS https://mail.genoric.com/api/health
curl -fsS https://genoric.com/api/health
```

同时验证 MailFlow Web、登录、邮件列表和 WebSocket，并用 `docker inspect mailflow-frontend` 确认
frontend 只位于 `mailflow_internal` 与 `edge_mailflow`。

禁止修改 backend 固定地址、数据库卷、Redis 卷、加密密钥或 WireGuard/策略路由；禁止执行
`docker compose down -v`、`docker system prune` 或模糊匹配删除。
