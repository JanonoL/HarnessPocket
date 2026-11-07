# 重启远程网关：按「谁在监听 127.0.0.1:8443」结束进程，再隐藏启动，最后校验注入版本。
# 为什么这么做：旧的重启方式按命令行文本匹配进程，用绝对路径启动的那个会漏掉，
# 结果新进程因端口占用直接退出、旧代码继续服务（改了半天看起来"没生效"）。
$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

Write-Host '[1/3] 停止当前监听 8443 的网关...'
$conns = Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
if (-not $conns) {
  Write-Host '      （没有监听者，跳过）'
} else {
  foreach ($c in $conns) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine -match 'gateway\.js') {
      Write-Host "      结束 PID $($c.OwningProcess)"
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    } else {
      Write-Host "      跳过 PID $($c.OwningProcess)（不是 gateway.js）"
    }
  }
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'gateway\.js' } |
  ForEach-Object {
    Write-Host "      清理残留 PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host '[2/3] 等待端口释放并启动...'
for ($i = 0; $i -lt 30; $i++) {
  $still = Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
  if (-not $still) { break }
  Start-Sleep -Milliseconds 300
}
Start-Process -FilePath 'wscript.exe' -ArgumentList (Join-Path $dir 'start-gateway-hidden.vbs') -WindowStyle Hidden
Start-Sleep -Seconds 4

Write-Host '[3/3] 校验...'
$c2 = Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }
if (-not $c2) {
  Write-Host '      启动失败：8443 没有监听者。请手动运行 start-gateway.bat 看报错。' -ForegroundColor Red
  exit 1
}
$p2 = Get-CimInstance Win32_Process -Filter "ProcessId=$($c2.OwningProcess)"
Write-Host "      网关已就绪 PID $($c2.OwningProcess)  启动时间 $($p2.CreationDate)" -ForegroundColor Green

# 校验服务端发出的注入脚本是不是新版本（关键标记 drawerMode）
try {
  $cfg = Get-Content (Join-Path $dir 'gateway.config.json') -Raw | ConvertFrom-Json
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-WebRequest 'http://127.0.0.1:8443/__gw_login' -Method POST -Body "token=$($cfg.token)" -ContentType 'application/x-www-form-urlencoded' -WebSession $sess -UseBasicParsing -MaximumRedirection 0 -ErrorAction SilentlyContinue | Out-Null
  $html = (Invoke-WebRequest 'http://127.0.0.1:8443/' -WebSession $sess -UseBasicParsing -TimeoutSec 20).Content
  $ok = [bool]($html -match 'drawerMode')
  Write-Host ("      注入脚本版本校验：drawerMode=" + $ok + "（应为 True）") -ForegroundColor ($(if ($ok) { 'Green' } else { 'Yellow' }))
} catch { Write-Host "      版本校验跳过：$($_.Exception.Message)" }

Write-Host ''
Write-Host '完成。注意：'
Write-Host '  * mobile.js / mobile.css / gateway.js 只在网关启动时读取一次，改完必须跑本脚本。'
Write-Host '  * 手机/浏览器刷新一次页面（HTML 带 no-store，刷新即取到新脚本）。'
Write-Host '  * 本机访问 http://127.0.0.1:8443/?token=<网关令牌>（令牌见 gateway.config.json 或 node info.mjs）'