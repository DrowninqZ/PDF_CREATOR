#Requires -RunAsAdministrator
<#
  表单 PDF 插件 —— 统计服务一键部署（Windows Server）

  用法（以管理员身份打开 PowerShell，在部署包根目录执行）：

      .\install.ps1                          # 默认端口 8787，自动生成后台口令
      .\install.ps1 -Port 8080               # 指定端口
      .\install.ps1 -AdminToken "你的口令"    # 指定后台口令
      .\install.ps1 -Uninstall               # 卸载服务

  部署包目录结构（本脚本必须在包根目录）：
      install.ps1      本脚本
      dist\            插件前端构建产物
      server\          统计服务（含生产依赖 node_modules）
      node\node.exe    便携版 Node，服务器无需单独安装
      WinSW.exe        服务包装器

  说明：全部依赖都已打进包里，服务器**不需要联网**。若包内缺少 node\node.exe，
  脚本会自动回退使用系统 PATH 里的 Node。
#>

[CmdletBinding()]
param(
  [int]$Port = 8787,
  [string]$AdminToken = '',
  [string]$AllowedOrigins = '',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$ServiceName = 'PdfCreatorStats'
$ServiceLabel = '表单PDF插件统计服务'
$RuleName = "PdfCreatorStats-$Port"

$Root = $PSScriptRoot
$ServerDir = Join-Path $Root 'server'
$DistDir = Join-Path $Root 'dist'
$NodeExe = Join-Path $Root 'node\node.exe'
$WinSWExe = Join-Path $Root 'WinSW.exe'
$ServiceDir = Join-Path $Root 'service'
$LogDir = Join-Path $Root 'logs'
$SvcExe = Join-Path $ServiceDir "$ServiceName.exe"
$SvcXml = Join-Path $ServiceDir "$ServiceName.xml"
$EnvFile = Join-Path $ServerDir '.env'

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Note($text) { Write-Host "  [!] $text" -ForegroundColor Yellow }

# 调用原生 exe。原生程序写 stderr 时，在 ErrorActionPreference=Stop 下可能被当成
# 终止错误，这里临时放宽并吞掉 stderr，只把退出码返回给调用方判断。
function Invoke-Native {
  param([string]$Exe, [string[]]$CmdArgs = @())
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Exe @CmdArgs 2>$null | Out-Null
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  return $code
}

# ---------------------------------------------------------------- 卸载

if ($Uninstall) {
  Write-Step "卸载服务 $ServiceName"
  if (Test-Path $SvcExe) {
    Invoke-Native -Exe $SvcExe -CmdArgs @('stop') | Out-Null
    Invoke-Native -Exe $SvcExe -CmdArgs @('uninstall') | Out-Null
    Write-Ok '服务已卸载'
  } else {
    Write-Note "未找到 $SvcExe，改用 sc.exe 兜底卸载"
    $sc = Join-Path $env:SystemRoot 'System32\sc.exe'
    Invoke-Native -Exe $sc -CmdArgs @('stop', $ServiceName) | Out-Null
    Invoke-Native -Exe $sc -CmdArgs @('delete', $ServiceName) | Out-Null
  }
  if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $RuleName
    Write-Ok '防火墙规则已移除'
  }
  Write-Host "`n数据保留在 $ServerDir\data，如需彻底清除请手动删除该目录。" -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------- 前置检查

Write-Step '检查部署包完整性'

if (-not (Test-Path (Join-Path $ServerDir 'index.js'))) {
  throw "未找到 $ServerDir\index.js。请把整个部署包解压后，在包根目录运行 install.ps1。"
}
Write-Ok "服务端源码：$ServerDir"

if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
  throw "未找到 $DistDir\index.html。部署包不完整，插件前端无法托管。"
}
Write-Ok "插件前端：$DistDir"

# 选 Node：优先用包内的便携版，保证与开发环境一致
$node = $null
if (Test-Path $NodeExe) {
  $node = $NodeExe
  Write-Ok "使用包内便携版 Node：$NodeExe"
} else {
  $sysNode = Get-Command node -ErrorAction SilentlyContinue
  if ($sysNode) {
    $node = $sysNode.Source
    Write-Note "包内无 node\node.exe，改用系统 Node：$node"
  }
}
if (-not $node) {
  throw '未找到可用的 Node。请确认包内有 node\node.exe，或在服务器上安装 Node 24 及以上版本（需加入 PATH）。'
}

# 版本校验：服务端用了内置 node:sqlite，要求 Node >= 23.4
$nodeVersion = (& $node -v).Trim()
$parts = $nodeVersion.TrimStart('v').Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 23 -or ($major -eq 23 -and $minor -lt 4)) {
  throw "Node 版本过低（$nodeVersion），需要 23.4 及以上。服务端使用了 Node 内置的 node:sqlite。"
}
Write-Ok "Node 版本 $nodeVersion 符合要求"

if (-not (Test-Path $WinSWExe)) {
  throw "未找到 $WinSWExe，无法注册 Windows 服务。"
}
Write-Ok "服务包装器：$WinSWExe"

# ---------------------------------------------------------------- 配置文件

Write-Step '生成配置文件'

if (Test-Path $EnvFile) {
  Write-Note "$EnvFile 已存在，保留原配置不改动"
} else {
  if (-not $AdminToken) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $AdminToken = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  }
  $content = "PORT=$Port`r`nADMIN_TOKEN=$AdminToken`r`nALLOWED_ORIGINS=$AllowedOrigins`r`n"
  # 必须写成不带 BOM 的 UTF-8，否则 dotenv 读到的第一个键名会被 BOM 污染
  [System.IO.File]::WriteAllText($EnvFile, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "已生成 $EnvFile"
  Write-Host "  后台口令：$AdminToken" -ForegroundColor Magenta
}

# ---------------------------------------------------------------- 依赖

Write-Step '检查依赖'

$NodeModules = Join-Path $ServerDir 'node_modules'
if (Test-Path $NodeModules) {
  Write-Ok '包内已含生产依赖，无需联网安装'
} else {
  Write-Note '包内无 node_modules，尝试用 npm 安装（需要联网）'
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw '包内无 node_modules 且系统没有 npm，无法安装依赖。请使用完整部署包。'
  }
  Push-Location $ServerDir
  try {
    & npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm ci 失败，退出码 $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  Write-Ok '依赖安装完成'
}

# ---------------------------------------------------------------- 注册服务

Write-Step "注册 Windows 服务 $ServiceName"

# 必须先把可能已存在的旧服务停掉并卸载，否则旧的 exe 正在运行、无法覆盖
if (Test-Path $SvcExe) {
  Invoke-Native -Exe $SvcExe -CmdArgs @('stop') | Out-Null
  Invoke-Native -Exe $SvcExe -CmdArgs @('uninstall') | Out-Null
  Start-Sleep -Seconds 2
} else {
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    $sc = Join-Path $env:SystemRoot 'System32\sc.exe'
    Invoke-Native -Exe $sc -CmdArgs @('stop', $ServiceName) | Out-Null
    Invoke-Native -Exe $sc -CmdArgs @('delete', $ServiceName) | Out-Null
    Start-Sleep -Seconds 2
  }
}

New-Item -ItemType Directory -Force -Path $ServiceDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Copy-Item -Path $WinSWExe -Destination $SvcExe -Force

# XML 里的路径需要转义，避免路径含 & 等字符时配置失效
function Esc($s) { [System.Security.SecurityElement]::Escape($s) }

$xml = @"
<service>
  <id>$ServiceName</id>
  <name>$ServiceLabel</name>
  <description>接收多维表格插件的使用上报，并提供统计后台与插件前端托管。</description>
  <executable>$(Esc $node)</executable>
  <arguments>index.js</arguments>
  <workingdirectory>$(Esc $ServerDir)</workingdirectory>
  <logpath>$(Esc $LogDir)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <startmode>Automatic</startmode>
  <stoptimeout>15sec</stoptimeout>
</service>
"@
[System.IO.File]::WriteAllText($SvcXml, $xml, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "已写入服务配置 $SvcXml"

$installCode = Invoke-Native -Exe $SvcExe -CmdArgs @('install')
if ($installCode -ne 0) {
  throw "服务注册失败，退出码 $installCode。请确认服务器已启用 .NET Framework 4.6.1 及以上。"
}
Write-Ok '服务注册成功'

Invoke-Native -Exe $SvcExe -CmdArgs @('start') | Out-Null
Start-Sleep -Seconds 3
Write-Ok '服务已启动'

# ---------------------------------------------------------------- 防火墙

Write-Step '配置防火墙'

if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
  Write-Note "防火墙规则 $RuleName 已存在，跳过"
} else {
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
  Write-Ok "已放通入站 TCP $Port"
}

# ---------------------------------------------------------------- 自检

Write-Step '部署自检'

$ok = $true
foreach ($p in @('/plugin/', '/')) {
  $url = "http://localhost:$Port$p"
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    Write-Ok "$url -> HTTP $($resp.StatusCode)"
  } catch {
    Write-Note "$url 访问失败：$($_.Exception.Message)"
    $ok = $false
  }
}

Write-Host ''
if ($ok) {
  Write-Host '部署完成。' -ForegroundColor Green
} else {
  Write-Host '服务已注册，但自检未全部通过。请查看日志：' -ForegroundColor Yellow
  Write-Host "  $LogDir\$ServiceName.out.log" -ForegroundColor Yellow
  Write-Host "  $LogDir\$ServiceName.err.log" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '访问地址：' -ForegroundColor Cyan
Write-Host "  统计后台    http://<服务器IP>:$Port/"
Write-Host "  插件页面    http://<服务器IP>:$Port/plugin/   （需在飞书里加载，普通浏览器会提示未连接多维表格）"
Write-Host ''
Write-Host '常用命令：' -ForegroundColor Cyan
Write-Host "  $SvcExe status | start | stop | restart"
Write-Host '  .\install.ps1 -Uninstall     卸载服务'
Write-Host ''
Write-Host '提醒：飞书插件正式环境要求 HTTPS，请在前面套一层反向代理（IIS / nginx / Caddy）。' -ForegroundColor Yellow
