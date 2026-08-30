# MailFlow 独立 Edge Gateway 接入

## 适用范围

本说明只适用于当前 `/opt/mailflow` 生产 Compose。仓库通用 `docker-compose.yml`、GHCR 快速安装
Compose 和 Caddy 部署保持通用，不得直接覆盖服务器专用文件。

生产基线：

- frontend 镜像：`ghcr.io/yunque0912/mailflow-frontend:3.3.0-custom.2`。
- frontend 无宿主机端口。
- `mailflow` 对应 `mailflow_internal`。
- `projectflow_proxy` 对应 external network `deploy_projectflow_internal`。
- backend 在 `mailflow_internal` 中的固定地址、PostgreSQL、Redis 和现有卷保持不变。

## 并行迁移

`docker-compose.edge-migration.yml` 明确让 frontend 同时加入：

```text
mailflow_internal
deploy_projectflow_internal
edge_mailflow（alias: mailflow-ingress）
```

复制到 `/opt/mailflow/docker-compose.edge-migration.yml` 后，必须与服务器 base Compose 联合使用：

```bash
sudo /usr/bin/docker compose \
  --project-directory /opt/mailflow \
  --env-file /opt/mailflow/.env \
  -f /opt/mailflow/docker-compose.yml \
  -f /opt/mailflow/docker-compose.edge-migration.yml \
  config --quiet

sudo /usr/bin/docker compose \
  --project-directory /opt/mailflow \
  --env-file /opt/mailflow/.env \
  -f /opt/mailflow/docker-compose.yml \
  -f /opt/mailflow/docker-compose.edge-migration.yml \
  up -d --no-deps frontend
```

并行阶段不得移除 `projectflow_proxy`，否则旧公网 Nginx 无法作为快速回滚入口。

## 稳态配置

独立 Edge 通过联合验收并完成观察窗口后，服务器 base Compose 中 frontend 应永久改为：

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

从 base Compose 删除 `projectflow_proxy` 后，先运行 `config --quiet`，再只重建 frontend。确认
`mailflow-frontend` 仅连接 `mailflow_internal` 与 `edge_mailflow` 后，删除迁移 overlay。

后续 `mailflow-update` 仍只操作 base `docker-compose.yml`，因此 base 文件必须永久包含
`edge_mailflow`；不能长期依赖 overlay，也不能用上游通用 Compose 覆盖生产文件。

## 验收与禁止操作

```bash
curl -fsS https://mail.genoric.com/api/health
curl -fsS https://genoric.com/api/health
```

同时验证 WebSocket、登录和邮件列表。禁止修改 backend 固定地址、数据库卷、Redis 卷、加密密钥或
WireGuard/策略路由；禁止执行 `docker compose down -v`。
