# 个人博客项目

## 当前已覆盖的基础模块

- 用户注册、登录、JWT 鉴权
- 博客文章创建、展示、编辑、删除
- Markdown 文章展示
- 文章评论
- 文章与评论点赞 / 取消点赞
- AI 文章总结
- SQLite 数据库
- React 前端与 FastAPI 后端分离

## 本地运行

当前机器的 `python -m venv` 在 `ensurepip` 阶段会失败，所以后端依赖已安装到项目内 `backend/.python_packages`。可以直接使用下面的脚本启动。

### 后端

如果 `backend/.python_packages` 不存在，先安装依赖：

```powershell
cd backend
python -m pip install -r requirements.txt --target .python_packages
```

启动后端：

```powershell
cd backend
.\start-dev.ps1
```

后端地址：`http://127.0.0.1:8000`

### 前端

```powershell
cd frontend
npm install
.\start-dev.ps1
```

前端地址：`http://127.0.0.1:5173`

本地前端通过 `frontend/.env.development` 请求 `http://127.0.0.1:8000/api`。如需覆盖，设置 `frontend/.env.local`：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

## 演示账号

本地数据库首次初始化时会生成演示账号：

- 邮箱：`river@example.com`
- 密码：`password123`

也可以直接在页面注册新账号。

## 部署到 Vercel + Render

本项目保持前后端分离：

- 前端部署到 Vercel，Root Directory 使用 `frontend`。
- 后端部署到 Render，Root Directory 使用 `backend`。
- 数据库继续使用 SQLite，不迁移 PostgreSQL。Render 上建议使用 Persistent Disk 保存数据库文件。

### Vercel 前端设置

- Framework Preset：`Vite`
- Root Directory：`frontend`
- Build Command：`npm run build`
- Output Directory：`dist`
- Install Command：`npm install`

Environment Variables：

```env
VITE_API_BASE_URL=https://你的-render-backend域名.onrender.com/api
```

注意：`VITE_API_BASE_URL` 必须包含 `/api` 后缀。

### Render 后端设置

- Service Type：`Web Service`
- Runtime：`Python`
- Root Directory：`backend`
- Build Command：`pip install -r requirements.txt`
- Start Command：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path：`/api/health`

Environment Variables：

```env
CORS_ORIGINS=https://你的-vercel域名.vercel.app
BLOG_DATABASE_PATH=/var/data/blog.db
BLOG_SECRET_KEY=换成一串足够长的随机字符串
```

如果启用 AI 总结，再额外配置：

```env
BLOG_AI_API_KEY=你的模型服务密钥
BLOG_AI_BASE_URL=你的 OpenAI-compatible base url，例如 https://dashscope.aliyuncs.com/compatible-mode/v1
BLOG_AI_MODEL=你的模型名
```

Persistent Disk 建议：

- Mount Path：`/var/data`
- `BLOG_DATABASE_PATH`：`/var/data/blog.db`

如果 Vercel 后续绑定自定义域名，需要把自定义域名也加入 `CORS_ORIGINS`，多个来源用英文逗号分隔：

```env
CORS_ORIGINS=https://你的-vercel域名.vercel.app,https://你的自定义域名.com
```

## 当前阶段说明

- 这是可本地运行并可部署到 Vercel + Render 的版本。
- 后端数据库仍使用 SQLite；线上通过 Render Persistent Disk 保持数据持久化。
- 可选 / 拓展功能已记录在 `可选拓展功能记录.md`，基础功能稳定后再挑选 1-2 个实现。
