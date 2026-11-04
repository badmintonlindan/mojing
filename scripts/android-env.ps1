# 墨径 Android 本地构建环境（仅影响当前 PowerShell 进程）。
# 用法：
#   . .\scripts\android-env.ps1
# 若下载需要当前 Windows 用户代理：. .\scripts\android-env.ps1 -UseSystemProxy
#   npm.cmd run android:sync
#   Push-Location android
#   .\gradlew.bat :app:assembleDebug
#   Pop-Location
# 已安装 .tools\gradle-8.14.3 时，可用 gradle -p android --no-daemon :app:assembleDebug，
# 与 wrapper 为同一 Gradle 版本，避免再次下载 -all 分发包。
# APK：android\app\build\outputs\apk\debug\app-debug.apk
# 设备验证：adb devices -l；adb install -r <APK路径>
# 工具来源、版本和校验和见 docs\DECISIONS.md。
# 不把 .tools 目录提交到源码仓库，也不覆盖用户全局 JAVA_HOME/PATH。

param([switch]$UseSystemProxy)

$ErrorActionPreference = 'Stop'
$mojingProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mojingSdkRoot = Join-Path $mojingProjectRoot '.tools\android-sdk'
$mojingJdkRoot = Join-Path $mojingProjectRoot '.tools\jdk'

if (Test-Path -LiteralPath (Join-Path $mojingJdkRoot 'bin\java.exe')) {
    $mojingJavaHome = $mojingJdkRoot
} else {
    $mojingJavaDirectory = Get-ChildItem -LiteralPath $mojingJdkRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
        Select-Object -First 1
    if (-not $mojingJavaDirectory) {
        throw '未找到 .tools\jdk 下的 JDK 21。请按 docs\DECISIONS.md 下载并解压。'
    }
    $mojingJavaHome = $mojingJavaDirectory.FullName
}

$mojingSdkManager = Join-Path $mojingSdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $mojingSdkManager)) {
    throw '未找到 .tools\android-sdk\cmdline-tools\latest\bin\sdkmanager.bat。'
}

$env:JAVA_HOME = $mojingJavaHome
$env:ANDROID_HOME = $mojingSdkRoot
$env:ANDROID_SDK_ROOT = $mojingSdkRoot
$env:ANDROID_USER_HOME = Join-Path $mojingProjectRoot '.tools\android-user'
$env:ANDROID_AVD_HOME = Join-Path $mojingProjectRoot '.tools\avd'
if (-not $env:GRADLE_USER_HOME) {
    $env:GRADLE_USER_HOME = Join-Path $mojingProjectRoot '.tools\gradle-cache'
}
$mojingToolPaths = @(
    (Join-Path $mojingJavaHome 'bin'),
    (Join-Path $mojingSdkRoot 'platform-tools'),
    (Join-Path $mojingSdkRoot 'cmdline-tools\latest\bin'),
    (Join-Path $mojingSdkRoot 'emulator')
)
$env:Path = ($mojingToolPaths + @($env:Path)) -join [IO.Path]::PathSeparator
if (Test-Path -LiteralPath (Join-Path $mojingProjectRoot '.tools\gradle-8.14.3\bin\gradle.bat')) {
    $env:Path = (Join-Path $mojingProjectRoot '.tools\gradle-8.14.3\bin') + [IO.Path]::PathSeparator + $env:Path
}
if ($UseSystemProxy) {
    $mojingProxy = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($mojingProxy.ProxyEnable -eq 1 -and $mojingProxy.ProxyServer -match '^(?:https?://)?(?<server>[^:/;@]+):(?<port>\d+)$') {
        $mojingProxyHost = $Matches.server
        $mojingProxyPort = $Matches.port
        $mojingProxyOptions = "-Dhttp.proxyHost=$mojingProxyHost -Dhttp.proxyPort=$mojingProxyPort -Dhttps.proxyHost=$mojingProxyHost -Dhttps.proxyPort=$mojingProxyPort"
        $env:GRADLE_OPTS = (@($env:GRADLE_OPTS, $mojingProxyOptions) | Where-Object { $_ }) -join ' '
        Write-Host "Gradle 使用当前用户代理 $mojingProxyHost`:$mojingProxyPort（仅本进程）"
    } else {
        Write-Warning '未发现受支持的单地址用户代理；未修改 Gradle 代理设置。'
    }
}
Write-Host "JAVA_HOME=$mojingJavaHome"
Write-Host "ANDROID_HOME=$mojingSdkRoot"
