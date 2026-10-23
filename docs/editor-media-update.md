# 图片与文章配乐更新

日期：2026-10-23。本地实现，尚未部署到生产服务器。

## 使用方式

- 删除原插图助手。正文上方的 ＋ 打开系统文件选择器；手机由系统提供相册或文件入口，也可把照片直接拖进 Markdown 正文。支持多选，每张最大 10 MB。
- JPG、PNG 直接上传；HEIC/HEIF 在服务器转换为 JPEG 并校正方向。上传后的文件统一使用 `image_数字`，Markdown 图片文字依次为 `image_1`、`image_2`，不包含原始文件名。原有文章和图片地址继续可用。
- 桌面继续显示 Markdown 和实时预览；980px 以下通过“编辑／预览”切换。上传期间可以继续写作，完成后替换预留位置，不覆盖期间输入的文字；上传完成前暂停保存。
- 点击 ♫，粘贴网易云单曲完整链接、短链接或包含链接的分享文字。文章正文开头只保留一个播放器，可在同一入口替换或移除。直接粘贴到正文的链接保留为普通链接。
- 播放器默认暂停，支持播放、暂停和进度调整。作者添加音乐不需要网易云 VIP。VIP、购买及地区权限由每一位听众自己的账号和网易云播放接口决定；试听片段不会当成完整歌曲播放。
- 需要授权时弹出网易云扫码登录；手机也提供打开授权页面的入口，实际唤端行为取决于手机系统及网易云页面。登录状态按当前浏览器记住，最多 30 天，网易云提前使其失效时需重新授权。播放器内“网易云账号”可以退出或切换。

## 本地启动

项目使用现有 React/Vite + FastAPI，新增一个仅监听 `127.0.0.1` 的 Node.js 音乐适配服务。Node.js 建议使用 22 LTS。

```powershell
npm --prefix frontend ci
npm --prefix music-service ci --ignore-scripts
python -m pip install -r backend/requirements.txt --target .dist/local-acceptance/python_packages
.\start-local-acceptance.ps1 -WithMusic
```

如果旧版验收环境正在运行，先执行 `.\start-local-acceptance.ps1 -Stop` 再启动，原有验收数据会保留。

访问 http://127.0.0.1:5174 。如果 3001 已占用，可传 `-MusicPort 3002`。停止使用 `.\start-local-acceptance.ps1 -Stop`。

也可分别启动服务：在 `music-service` 运行 `npm start`，在已安装新增 Python 依赖的环境中按原方式启动后端和前端。

## 生产配置

1. 在生产 Python 环境安装更新后的 `backend/requirements.txt`。
2. 上传 `music-service` 的 package.json、package-lock.json、server.cjs、qr-auth.cjs，以运行该服务的普通用户执行 `npm ci --omit=dev --ignore-scripts`。
3. 用现有进程管理器运行 `node /实际项目目录/music-service/server.cjs`，工作目录为 music-service，并设置开机启动。服务默认仅监听 `127.0.0.1:3001`，无需开放公网端口或新增 Nginx 音乐代理。
4. 后端可配置 `BLOG_MUSIC_API_URL=http://127.0.0.1:3001`；音乐服务可配置 `BLOG_MUSIC_PORT=3001`。HTTPS 生产环境配置 `BLOG_MUSIC_COOKIE_SECURE=true`。前端继续通过同源 `/api` 请求后端。
5. 保留现有 `/uploads/` 静态目录代理，Nginx 的 server 块配置 `client_max_body_size 12m;`，为 10 MB 文件及 multipart 请求头留出空间。按原流程重新构建和发布前端，再重启后端与音乐服务。

浏览器只保存不含网易云登录凭据的随机 HttpOnly Cookie，使用 SameSite=Lax；后端持久化会话，按浏览器隔离，不绑定博客账号。数据库及其备份包含授权凭据，应与博客账号数据一样限制访问。Cookie、歌曲播放地址和登录 API 响应不允许缓存。没有作者账号共享，也未接入解锁、替换曲源或下载接口。

## 来源与验证边界

网易云适配基于 MIT 开源项目 [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，固定 npm `@neteasecloudmusicapienhanced/api` 4.41.1 并提供锁文件。仅允许查询歌曲、获取当前听众有权访问的播放地址、生成/检查登录二维码及读取登录状态。它是第三方接口，网易云接口变化或服务风控可能影响可用性。

HEIC 解码使用 [pillow-heif](https://pillow-heif.readthedocs.io/) 与 Pillow。图片插入、普通歌曲播放已由用户验收；扫码登录修复后，用户已用手机网易云 App 确认真实账号授权，并确认 VIP 歌曲播放成功。iOS/Android 系统选择器及同一手机打开授权页面的唤端行为仍未完成实体设备专项检查。

## 本轮验证记录

- 24 项后端集成测试通过：真实 JPG/PNG/HEIC 解码、上传鉴权与大小限制、链接校验、浏览器间授权隔离、会话记忆/退出/失效、拒绝把试听片段当作完整 VIP 歌曲、摘要去除音乐和图片标记，以及本次新增的多 Cookie 解析、授权同步延迟、重复检查和二维码刷新竞争。网易云账号及 VIP 返回值在这些测试中使用模拟响应。
- 5 项 Node 适配器测试通过：保留响应中的原始 Cookie、保留多条 Set-Cookie、一次性授权结果重试、按二维码隔离、缓存过期与容量限制。前端 TypeScript 检查和生产构建通过。
- 本次另用独立 Edge 浏览器完成 3 项模拟响应检查：手机确认后等待同步再登录、短暂断线后自动重试成功、连续断线后停止并提示重试且不会误报二维码失效。测试没有访问已验收用户的网易云会话，结果见 `.dist/media-qa/qr-fix-verification.json`。
- Microsoft Edge 的真实浏览器检查通过：多文件上传、正文拖入、上传期间继续写作、实时图片预览、保存后再次编辑、配乐添加/替换/移除、默认暂停、真实普通歌曲的播放与暂停。
- 在 360、390、768、980、1024、1440px 检查无页面横向溢出；手机布局的编辑/预览切换、＋ 文件选择入口及授权弹窗通过。手机系统相册/文件面板与唤端行为未在实体设备上实测。
- 真实账号验收通过：用户在 `http://127.0.0.1:5175` 重新扫码确认后反馈成功；服务端只读核对确认浏览器授权已持久化，随后 VIP 歌曲播放接口返回成功。不记录登录凭据或二维码密钥。
- 修复了原有 SQLite 连接退出上下文后未关闭的问题，避免登录检查累积数据库连接；自动摘要会跳过新增音乐标记及图片地址，手写摘要保留。

测试源码位于 `backend/tests/test_editor_media.py` 和 `music-service/qr-auth.test.cjs`。安装 `backend/requirements-dev.txt` 后运行 `python -m unittest discover -s backend/tests -v`；在 `music-service` 运行 `npm test`。本轮浏览器日志与截图保存于忽略目录 `.dist/media-qa/`。

## 扫码确认后登录失败的修复

网易云返回的多条 Set-Cookie 末尾包含分号，第三方库再次用分号拼接后出现连续分号；原先的 Cookie 解析器会提前停止，漏掉真正的登录凭据，导致手机确认后仍提示登录失败。现保留原始响应及每条 Cookie，并逐项提取所需的登录字段。对于可能只返回一次的成功授权，适配器按二维码短暂保留结果，支持连接重试。

授权尚在同步时显示等待状态；短暂连接失败会自动重试，只有明确过期或超过二维码有效期才显示失效。刷新二维码后，旧请求不会覆盖新授权。
