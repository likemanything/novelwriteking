# 公网部署（Docker Compose + Caddy 自动 HTTPS）

一台能装 Docker 的 Linux 服务器即可（1 核 2G 起）。若放在中国大陆服务器并用域名访问，需要先完成域名备案。

1. 安装 Docker，开放安全组/防火墙的 80、443 端口；把域名 A 记录解析到服务器 IP。
2. `git clone` 本仓库，进入目录，`cp deploy/env.production.example .env.production` 并填写。
   `docker compose` 还会读取同目录 `.env` 中的 `DOMAIN`、`POSTGRES_PASSWORD`、`INKLOOM_DB_PASSWORD`，
   最简单的做法是 `cp .env.production .env`（两个文件内容相同）。
3. `docker compose up -d --build`，数据库迁移会在应用启动时自动执行。
4. 浏览器打开 `PUBLIC_URL`。生成内测邀请码：
   `docker compose exec app npm run admin -- code 5 1 内测批次`

备份：数据库卷 `pgdata`、媒体卷 `media`，以及 `MASTER_KEY`。
更新：`git pull && docker compose up -d --build`。
