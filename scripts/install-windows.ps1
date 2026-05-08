# ThunderClaw 一键 Windows 安装器（v0.3.0+：Go binary，**无 Node 依赖**）。
#
# 装：
#   irm https://raw.githubusercontent.com/pekinlcc/thunderclaw/main/scripts/install-windows.ps1 | iex
#
# 锁版：
#   $version='0.3.0'; irm .../install-windows.ps1 | iex
#
# 干的事：
#   1. 探宿主架构（amd64）
#   2. 下载 host tarball（zip），把 thunderclaw-host.exe 放 %LOCALAPPDATA%\ThunderClaw\
#   3. 注册 NMH manifest 到 HKCU\Software\Mozilla\NativeMessagingHosts\thunderclaw
#   4. 把 XPI 丢进 TB 默认 profile 的 extensions\
#   5. 写 user.js：autoDisableScopes=0 + xpinstall.signatures.required=false
#   6. 启动 Thunderbird

$ErrorActionPreference = 'Stop'
$Repo = 'pekinlcc/thunderclaw'
$ExtId = 'thunderclaw@pekinlcc.dev'

function Resolve-Version {
    param([string]$v)
    if ($v -and $v -ne 'latest') { return $v }
    # 走 redirect，避开 GitHub API 限流
    $resp = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($resp.Headers.Location) {
        $loc = $resp.Headers.Location
        if ($loc -match '/releases/tag/v(.+)$') { return $matches[1] }
    }
    throw 'Cannot resolve latest version. Pass $version explicitly.'
}

function Get-DefaultThunderbirdProfile {
    $iniPath = "$env:APPDATA\Thunderbird\profiles.ini"
    if (-not (Test-Path $iniPath)) {
        throw "profiles.ini not found at $iniPath. Start Thunderbird at least once first."
    }
    $lines = Get-Content $iniPath
    # 优先 [Install*].Default
    $inInstall = $false
    foreach ($line in $lines) {
        if ($line -match '^\[Install') { $inInstall = $true; continue }
        if ($line -match '^\[' -and -not ($line -match '^\[Install')) { $inInstall = $false; continue }
        if ($inInstall -and $line -match '^Default=(.+)$') {
            return "$env:APPDATA\Thunderbird\$($matches[1] -replace '/', '\')"
        }
    }
    # 退到 [Profile*].Default=1
    $inProfile = $false; $path = $null; $isDefault = $false
    foreach ($line in $lines) {
        if ($line -match '^\[Profile') { $inProfile = $true; $path = $null; $isDefault = $false; continue }
        if ($line -match '^\[' -and -not ($line -match '^\[Profile')) {
            if ($inProfile -and $isDefault -and $path) {
                return "$env:APPDATA\Thunderbird\$($path -replace '/', '\')"
            }
            $inProfile = $false
        }
        if ($inProfile) {
            if ($line -match '^Path=(.+)$') { $path = $matches[1] }
            if ($line -match '^Default=1') { $isDefault = $true }
        }
    }
    throw 'Cannot find a default Thunderbird profile in profiles.ini'
}

$version = if ($script:version) { $script:version } else { Resolve-Version 'latest' }
Write-Host "==> 装 ThunderClaw v$version" -ForegroundColor Cyan

# 1) 下载 host zip
$tmp = Join-Path $env:TEMP "thunderclaw-$([Guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zipUrl = "https://github.com/$Repo/releases/download/v$version/thunderclaw-native-host-v$version.zip"
    $zipPath = Join-Path $tmp 'host.zip'
    Write-Host "==> 下载 native host：$zipUrl" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $tmp

    $hostBinSrc = Join-Path $tmp "thunderclaw-native-host-v$version\host-bin\windows-amd64\thunderclaw-host.exe"
    if (-not (Test-Path $hostBinSrc)) {
        throw "host binary not found in zip: $hostBinSrc"
    }

    # 2) 复制 binary 到 %LOCALAPPDATA%\ThunderClaw
    $libDir = "$env:LOCALAPPDATA\ThunderClaw"
    New-Item -ItemType Directory -Path $libDir -Force | Out-Null
    $binDst = Join-Path $libDir 'thunderclaw-host.exe'
    Copy-Item -Path $hostBinSrc -Destination $binDst -Force
    Write-Host "  ✓ binary → $binDst" -ForegroundColor Green

    # 3) 写 NMH manifest + 注册表
    $manifestPath = Join-Path $libDir 'thunderclaw.json'
    $manifest = @{
        name = 'thunderclaw'
        description = 'ThunderClaw native messaging host'
        path = $binDst
        type = 'stdio'
        allowed_extensions = @($ExtId)
    } | ConvertTo-Json -Depth 5
    $manifest | Out-File -FilePath $manifestPath -Encoding UTF8 -Force

    $regKey = 'HKCU:\Software\Mozilla\NativeMessagingHosts\thunderclaw'
    if (-not (Test-Path $regKey)) {
        New-Item -Path $regKey -Force | Out-Null
    }
    Set-ItemProperty -Path $regKey -Name '(default)' -Value $manifestPath
    Write-Host "  ✓ NMH registered at $regKey" -ForegroundColor Green

    # 4) 下 XPI
    $xpiUrl = "https://github.com/$Repo/releases/download/v$version/thunderclaw-$version.xpi"
    $xpiPath = Join-Path $tmp 'thunderclaw.xpi'
    Write-Host "==> 下载 XPI" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $xpiUrl -OutFile $xpiPath

    # 5) 落进 TB profile
    $profile = Get-DefaultThunderbirdProfile
    Write-Host "==> 目标 profile：$profile" -ForegroundColor Cyan
    if (-not (Test-Path $profile)) { throw "profile dir not found: $profile" }
    $extDir = Join-Path $profile 'extensions'
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    Copy-Item -Path $xpiPath -Destination (Join-Path $extDir "$ExtId.xpi") -Force
    Write-Host "  ✓ XPI → $extDir\$ExtId.xpi" -ForegroundColor Green

    # 6) user.js auto-enable
    $userJs = Join-Path $profile 'user.js'
    $marker = '// thunderclaw:auto-enable'
    $existingPrefs = if (Test-Path $userJs) { Get-Content $userJs -Raw } else { '' }
    if ($existingPrefs -notmatch [regex]::Escape($marker)) {
        $append = @"

$marker  # 由 install-windows.ps1 写入
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("xpinstall.signatures.required", false);
"@
        Add-Content -Path $userJs -Value $append
        Write-Host "  ✓ user.js auto-enable prefs 已加" -ForegroundColor Green
    } else {
        Write-Host "  ✓ user.js 已含 thunderclaw 配置，跳过" -ForegroundColor Green
    }

    # 7) 启动 TB
    $tbExe = Get-Command thunderbird.exe -ErrorAction SilentlyContinue
    if (-not $tbExe) { $tbExe = "$env:ProgramFiles\Mozilla Thunderbird\thunderbird.exe" }
    if ($tbExe) {
        # 关掉再开
        Get-Process thunderbird -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        Start-Process -FilePath $tbExe.Source ?? $tbExe
        Write-Host "✓ Thunderbird 已启动" -ForegroundColor Green
    } else {
        Write-Host "⚠️  找不到 thunderbird.exe，请手动启动 Thunderbird" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "装完了。左侧 Spaces 栏点 'AI 助手' 图标即可。" -ForegroundColor Green
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
