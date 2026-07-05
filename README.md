# 个人博客项目

## 当前已覆盖的基础模块

- 用户注册、登录、JWT 鉴权
- 博客文章创建、展示、编辑、删除
- Markdown 文章展示
- 文章评论
- 文章与评论点赞 / 取消点赞
- SQLite 本地开发数据库
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

## 演示账号

本地数据库首次初始化时会生成演示账号：

- 邮箱：`river@example.com`
- 密码：`password123`

也可以直接在页面注册新账号。

## 当前阶段说明

- 这是本地可运行版本，数据库使用 SQLite，方便先完成基础功能。
- 后续上线前再切换 PostgreSQL，并补 Docker Compose、GitHub Actions 和云服务器部署说明。
- 可选 / 拓展功能已记录在 `可选拓展功能记录.md`，基础功能稳定后再挑选 1-2 个实现。

