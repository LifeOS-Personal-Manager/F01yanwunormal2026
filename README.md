# 言午 GrowTogether

面向家庭成员的青少年成长协作工作台。当前交付包含可运行的响应式前端、FastAPI 服务、本地 SQLite 支持和 PostgreSQL 部署配置。本地示例家庭与记录均为虚构演示数据。

## 首次安装

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.txt
```

## 本地启动

一条命令同时启动前后端：

```powershell
.\scripts\start-local.ps1
```

也可分别启动：

```powershell
npm run dev -- --host 127.0.0.1
.\.venv\Scripts\python.exe -m uvicorn apps.api.main:app --reload --port 8000
```

前端地址为 `http://127.0.0.1:5173`，API 文档为 `http://127.0.0.1:8000/docs`，健康检查为 `http://127.0.0.1:8000/api/v1/health`。本地数据保存在 `apps/api/yanwu.db`。

六个主页面支持直接 URL 访问：`/`、`/child`、`/records`、`/learning`、`/follow-ups`、`/goals`，家庭设置位于 `/settings/family`。档案、记录、作业、共同跟进、成长目标和家庭设置均已接通 FastAPI 与 SQLite；生产能力边界见 `docs/IMPLEMENTATION_STATUS.md`。

## 上线配置

Vercel 构建前端时必须设置 `VITE_API_URL`，值为 Render API 的完整 `/api/v1` 地址。Render 必须设置持久化 PostgreSQL 的 `DATABASE_URL`，并将 `WEB_ORIGIN` 设置为 Vercel 前端域名。正式环境保持 `SEED_DEMO_DATA=false`。

不要将 `apps/api/yanwu.db` 上传到代码仓库；它可能包含家庭资料、账户名和密码哈希。首次上线空数据库后，由监护人在登录页创建第一个家庭账户。

上线前执行：

```powershell
& '.\.venv\Scripts\python.exe' tests\e2e_api_flow.py
npm run build
```

示例变量见 `.env.example`。当前认证由 FastAPI 本地账户实现，尚未接入 Supabase Auth；其余未完成边界见 `docs/IMPLEMENTATION_STATUS.md`。
