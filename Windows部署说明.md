# Windows Server 部署说明

本项目在服务器上只需要部署**两个目录、一个进程**：

| 部分 | 说明 |
| --- | --- |
| `server/` | Node 服务：接收插件上报、写 SQLite、提供统计后台 |
| `dist/` | 插件前端构建产物，由同一个服务在 `/plugin/` 下托管 |

因为插件页面和统计接口由同一个进程、同一个端口提供，二者**同源**，所以不需要配置跨域（CORS）。

---

## 一键部署（推荐）

如果需要快速上线，直接用现成的离线部署包，**服务器不需要联网**：

```
pdf-creator-deploy.zip
  ├─ install.ps1        一键安装脚本
  ├─ dist\              插件前端构建产物
  ├─ server\            统计服务（已含生产依赖）
  ├─ node\node.exe      便携版 Node，服务器无需单独安装
  ├─ WinSW.exe          服务包装器
  └─ README.txt
```

操作就三步：

1. 解压到服务器，例如 `D:\pdf-creator\`
2. 以**管理员身份**打开 PowerShell，进入该目录
3. 执行 `.\install.ps1`

脚本会自动完成：检查环境 → 生成配置（随机后台口令）→ 注册 Windows 服务并设为开机自启 → 放通防火墙 → 自检并打印访问地址。

可选参数：

```powershell
.\install.ps1 -Port 8080                       # 换端口
.\install.ps1 -AdminToken "你的口令"            # 指定后台口令
.\install.ps1 -AllowedOrigins "https://xxx"    # 限制上报来源
.\install.ps1 -Uninstall                       # 卸载服务
```

> 部署包由 `server/deploy/install.ps1` 加上构建产物组装而成。生成方式见文末「附：重新生成部署包」。

下面的第二~八节是**手动部署步骤**，等价于脚本所做的事，供需要逐步排查或定制时参考。

---

## 一、前置要求

- Windows Server 2016 及以上
- **Node.js ≥ 23.4**（服务端使用了 Node 内置的 `node:sqlite`）。建议直接装当前 **Node 24 LTS**
- **不需要** Visual Studio、Python、node-gyp 等编译工具链 —— 本项目没有任何需要编译的原生依赖

验证安装：

```
node -v
```

---

## 二、在开发机准备部署包

### 1. 构建插件前端

在项目根目录新建 `.env`，指定上报地址：

```
VITE_ANALYTICS_ENDPOINT=/api/usage
```

> 这里用**相对路径**是刻意的：插件页面和接口同源，浏览器会自动解析成 `https://你的域名/api/usage`，不用把域名写死在包里。
> 如果以后插件前端和统计服务分开部署（不同域名），再改成完整地址，例如 `VITE_ANALYTICS_ENDPOINT=https://stats.example.com/api/usage`。

然后构建：

```bash
npm ci
npm run build
```

产出 `dist/` 目录。

### 2. 拷贝到服务器

把以下两个目录拷到服务器，**保持相对位置**：

```
D:\pdf-creator\
  ├─ server\        ← 整个 server 目录
  └─ dist\          ← 构建产物
```

> 如果不想保持这个结构，可以放任意位置，只要在 `.env` 里用 `PLUGIN_DIST_DIR` 指定 `dist` 的绝对路径即可（见下一步）。
> `server\node_modules`、`server\data` 不用拷，服务器上重新装、自动建。

---

## 三、安装依赖与配置

进入 `D:\pdf-creator\server`：

```
npm ci --omit=dev
copy .env.example .env
notepad .env
```

`.env` 至少改这两项：

```ini
# 服务端口
PORT=8787

# 后台查询口令：必须改成一个强口令，否则统计后台任何人可访问
ADMIN_TOKEN=请换成长随机字符串

# 上报来源白名单（逗号分隔）。同源部署可留空；填的话写插件页面的来源域名
# ALLOWED_ORIGINS=https://plugins.example.com

# 仅当 dist 不在 server 的上一级目录时才需要配
# PLUGIN_DIST_DIR=D:\pdf-creator\dist
```

---

## 四、启动验证

```
npm start
```

启动日志会打印三行地址，确认第三行显示的是**已找到**而不是"未找到构建产物"：

```
使用统计服务已启动：http://localhost:8787
统计后台：http://localhost:8787/  上报接口：POST /api/usage
插件前端：http://localhost:8787/plugin/  （目录 D:\pdf-creator\dist）
```

浏览器访问确认：

| 地址 | 预期 |
| --- | --- |
| `http://localhost:8787/` | 统计后台页面（需输入 `ADMIN_TOKEN`） |
| `http://localhost:8787/plugin/` | 插件页面（普通浏览器里会提示"未连接多维表格"，**属正常**，因为没在飞书 iframe 里） |

> `/plugin/` 结尾的斜杠不能少。直接访问 `/plugin` 服务会自动 301 跳转过去。

---

## 五、注册为 Windows 服务（NSSM）

用 [NSSM](https://nssm.cc/download) 把服务做成开机自启的后台服务。下载后解压出 `win64\nssm.exe`，放到 `D:\pdf-creator\nssm.exe`。

**先建好日志目录**（NSSM 不会自动创建）：

```
mkdir D:\pdf-creator\logs
```

**以管理员身份**打开 CMD，逐条执行：

```
:: 注册服务（注意 node.exe 的实际路径）
D:\pdf-creator\nssm.exe install PdfCreatorStats "C:\Program Files\nodejs\node.exe" "D:\pdf-creator\server\index.js"

:: 工作目录必须是 server，否则读不到 .env、找不到数据库
D:\pdf-creator\nssm.exe set PdfCreatorStats AppDirectory "D:\pdf-creator\server"

:: 日志重定向
D:\pdf-creator\nssm.exe set PdfCreatorStats AppStdout "D:\pdf-creator\logs\out.log"
D:\pdf-creator\nssm.exe set PdfCreatorStats AppStderr "D:\pdf-creator\logs\err.log"

:: 日志改为追加模式。默认是覆盖，会导致服务每次重启都清空旧日志
D:\pdf-creator\nssm.exe set PdfCreatorStats AppStdoutCreationDisposition 4
D:\pdf-creator\nssm.exe set PdfCreatorStats AppStderrCreationDisposition 4

:: 日志轮换：单文件超过 10MB，或满 1 天，就滚动出一份
D:\pdf-creator\nssm.exe set PdfCreatorStats AppRotateFiles 1
D:\pdf-creator\nssm.exe set PdfCreatorStats AppRotateOnline 1
D:\pdf-creator\nssm.exe set PdfCreatorStats AppRotateBytes 10485760
D:\pdf-creator\nssm.exe set PdfCreatorStats AppRotateSeconds 86400

:: 开机自启 + 崩溃自动重启
D:\pdf-creator\nssm.exe set PdfCreatorStats Start SERVICE_AUTO_START
D:\pdf-creator\nssm.exe set PdfCreatorStats AppExit Default Restart
D:\pdf-creator\nssm.exe set PdfCreatorStats AppRestartDelay 5000

:: 启动
D:\pdf-creator\nssm.exe start PdfCreatorStats
```

常用管理命令：

```
nssm.exe status PdfCreatorStats
nssm.exe restart PdfCreatorStats
nssm.exe stop PdfCreatorStats
nssm.exe edit PdfCreatorStats      :: 图形界面改配置
nssm.exe remove PdfCreatorStats confirm   :: 卸载服务
```

---

## 六、开放端口与 HTTPS

### 防火墙

```
netsh advfirewall firewall add rule name="PdfCreatorStats" dir=in action=allow protocol=TCP localport=8787
```

### HTTPS（正式环境通常必须）

**飞书要求插件地址是 HTTPS**，浏览器也会拦住 http 页面里的部分能力。所以正式使用前，需要在前面套一层反向代理来提供证书，二选一：

- **IIS**：装 URL Rewrite + ARR，建站点绑定证书，反向代理到 `http://127.0.0.1:8787`
- **nginx for Windows** 或 **Caddy**：Caddy 最省事，两行配置就能自动申请证书

反代时记得把 `/api/usage`、`/api/admin`、`/plugin/` 全部转发过去（都在同一个端口，配一个全量转发即可）。

由于服务已开启 `trust proxy`，反代传过来的 `X-Forwarded-For` 会被正确记录为客户端 IP。

---

## 七、数据备份

数据库文件在 `D:\pdf-creator\server\data\`，使用的是 **WAL 模式**，所以除了 `usage.db` 还存在 `usage.db-wal`、`usage.db-shm`。

### 方案一：停服拷贝（推荐，最简单可靠）

统计是低写入场景，凌晨停服几秒没有影响。建一个 `backup.cmd`：

```bat
@echo off
setlocal
set STAMP=%date:~0,4%%date:~5,2%%date:~8,2%
set BACKUP_DIR=D:\pdf-creator-backup

if not exist "%BACKUP_DIR%" md "%BACKUP_DIR%"

nssm.exe stop PdfCreatorStats
xcopy /Y /I "D:\pdf-creator\server\data" "%BACKUP_DIR%\data-%STAMP%\"
nssm.exe start PdfCreatorStats

echo 已备份到 %BACKUP_DIR%\data-%STAMP%
endlocal
```

> 必须**整个 `data` 目录一起拷**，只拷 `usage.db` 会丢掉 WAL 里还没合并的数据。

然后用「任务计划程序」设为每天 03:00 执行。

### 方案二：不停服备份

用 SQLite 的 `VACUUM INTO`（需要服务端那个 `node` 在 PATH 里）：

```
node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('D:/pdf-creator/server/data/usage.db').exec(\"VACUUM INTO 'D:/pdf-creator-backup/usage.db'\")"
```

> 路径**必须用正斜杠**（`/`），不能用反斜杠，否则 JS 字符串里会被当成转义字符。

如果装了 sqlite3 命令行工具，也可以用：`sqlite3 usage.db ".backup D:\pdf-creator-backup\usage.db"`

---

## 八、升级流程

1. 开发机重新 `npm run build`
2. 覆盖服务器上的 `dist\`
3. 若改过服务端代码，覆盖 `server\*.js` 后执行 `npm ci --omit=dev`
4. `nssm.exe restart PdfCreatorStats`

数据库在 `server\data\` 下，升级不会动它。

---

## 九、常见问题

**插件页返回 503「插件前端未构建」**
`dist` 没拷进来，或 `PLUGIN_DIST_DIR` 配错了。看启动日志里打印的目录路径，确认那个目录下确实有 `index.html`。

**统计后台打开是空的 / 401**
`ADMIN_TOKEN` 没改或输错。口令存在浏览器里，换口令后需要清掉重新输入。

**上报一直没有数据**
构建时 `VITE_ANALYTICS_ENDPOINT` 没生效。检查构建产物里是否真的含上报地址：

```
findstr /C:"/api/usage" D:\pdf-creator\dist\assets\*.js
```

有输出才说明注入了。注意该变量是**构建期**注入的，改了要重新 `npm run build`。

**服务起不来 / 端口被占**

```
netstat -ano | findstr :8787
```

找到 PID 后 `tasklist /FI "PID eq <PID>"` 看是谁占的。

**日志在哪**
`D:\pdf-creator\logs\out.log`（正常输出）和 `err.log`（错误输出）。

注意 NSSM 轮换出来的旧日志**不会自动删除**，会一直堆着，建议用任务计划程序定期清理：

```bat
forfiles /P D:\pdf-creator\logs /M *.log.* /D -30 /C "cmd /c del @path"
```

---

## 附：重新生成部署包

一键部署包由以下内容组装而成，需要更新时在开发机重新生成：

```bash
# 1. 以同源相对地址构建插件前端（不要写死域名）
VITE_ANALYTICS_ENDPOINT=/api/usage npm run build

# 2. 组装目录
mkdir -p pdf-creator-deploy/server pdf-creator-deploy/node
rsync -a --exclude node_modules --exclude data --exclude .env --exclude deploy \
      server/ pdf-creator-deploy/server/
rsync -a dist/ pdf-creator-deploy/dist/
cp server/deploy/install.ps1                              pdf-creator-deploy/
cp server/deploy/README.txt                               pdf-creator-deploy/
cp /tmp/pdf-creator-cache/node.exe                         pdf-creator-deploy/node/node.exe
cp /tmp/pdf-creator-cache/WinSW.exe                        pdf-creator-deploy/WinSW.exe

# 3. 把生产依赖打进包内，服务器就不需要联网
cd pdf-creator-deploy/server && npm ci --omit=dev && cd ../..

# 4. 打包
zip -r -X release/pdf-creator-deploy.zip pdf-creator-deploy -x '*.DS_Store'
```

需要单独准备的两个二进制：

| 文件 | 来源 |
| --- | --- |
| `node.exe` | `https://nodejs.org/dist/v26.3.1/win-x64/node.exe`，版本需 ≥ 23.4，宜与开发环境一致 |
| `WinSW.exe` | NuGet 包 `winsw` 2.11.0 里的 `lib/net461-full/WinSW.NET461.exe` |

> 一键脚本用 **WinSW** 注册服务，而上面第五节手动步骤用的是 **NSSM**，两者作用等价。选 WinSW 是因为它按大小轮换日志时可以指定保留份数（`keepFiles`），NSSM 没有这个参数；同时 NSSM 官网在部分网络环境下不可达。

验证部署包是否完整（服务器上执行）：

```powershell
.\install.ps1        # 结尾的自检会打印两个地址的 HTTP 状态码
```

`node_modules` 里**不应有任何 `.node` 原生二进制**，可以用这条命令自查：

```bash
find pdf-creator-deploy/server/node_modules -name '*.node'
```

有输出说明依赖不纯，换到对应平台重新 `npm ci`。

---

## 附：关于"打包成 exe"

不需要。部署包已经把便携版 Node 一起带上了，**服务器不用装 Node、也不用联网**，效果和 exe 一样，却省掉了 exe 的几个代价：体积（Node 运行时同样要带，exe 并不会更小）、每次改需求都要重新构建、以及未签名 exe 首次运行会触发 SmartScreen 警告。

如果后续确实需要单文件 exe（例如要分发给多台机器），再用 Node 的 SEA 打包，届时需要把服务端改成 CJS 入口并把静态资源嵌进去。
