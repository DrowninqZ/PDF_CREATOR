表单 PDF 插件 —— 统计服务部署包
================================

一、把整个文件夹拷到服务器，例如 D:\pdf-creator\

二、以【管理员身份】打开 PowerShell，进入该目录，执行：

       .\install.ps1

   脚本会自动完成：检查环境 → 生成配置（随机口令）→ 注册服务 → 开机自启
   → 放通防火墙 → 自检。
   执行完终端会打印【后台口令】，请记下来，登录统计后台要用。

   可选参数：

       .\install.ps1 -Port 8080                 换端口
       .\install.ps1 -AdminToken "你的口令"      指定口令
       .\install.ps1 -AllowedOrigins "https://xxx"   限制上报来源
       .\install.ps1 -Uninstall                 卸载服务

三、验证

       统计后台   http://<服务器IP>:8787/
       插件页面   http://<服务器IP>:8787/plugin/

   插件页面要用飞书的插件地址加载；直接用普通浏览器打开会提示「未连接多维表格」，
   这是正常的。

四、注意事项

   * 飞书插件正式环境要求 HTTPS，需要在前面加一层反向代理（IIS / nginx / Caddy）
   * 数据库在 server\data\ ，升级时保留该目录即可，不要删
   * 日志在 logs\ ，自动按 10MB 轮换、保留 8 份
   * 服务器【不需要联网】，Node 和依赖都已打进包里

五、包内容

       install.ps1        一键安装脚本
       dist\              插件前端构建产物
       server\            统计服务（已含生产依赖 node_modules）
       node\node.exe      便携版 Node，服务器无需单独安装
       WinSW.exe          服务包装器（把 Node 程序注册成 Windows 服务）

六、常用命令

       service\PdfCreatorStats.exe status | start | stop | restart
       .\install.ps1 -Uninstall     卸载服务
