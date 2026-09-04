param(
    [string]$Version = "dev",
    [string]$WhisperBundleDirectory = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputRoot = Join-Path $RepoRoot ("dist\build-" + [Guid]::NewGuid().ToString('N'))
$PackageRoot = Join-Path $OutputRoot "EnglishLearnPath-Windows-x64"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "开发者构建需要 Go 1.22 或更高版本。普通使用者请直接下载 GitHub Releases 中的 ZIP。"
}

New-Item -ItemType Directory -Path $PackageRoot | Out-Null

$env:GOOS = "windows"
$env:GOARCH = "amd64"
Push-Location (Join-Path $RepoRoot "launcher")
try {
    go build -trimpath -ldflags "-s -w -H=windowsgui" -o (Join-Path $PackageRoot "启动学习中心.exe") .
}
finally {
    Pop-Location
}

Copy-Item -LiteralPath (Join-Path $RepoRoot "app") -Destination (Join-Path $PackageRoot "app") -Recurse
Copy-Item -LiteralPath (Join-Path $RepoRoot "docs") -Destination (Join-Path $PackageRoot "docs") -Recurse
Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination $PackageRoot
Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination $PackageRoot
Copy-Item -LiteralPath (Join-Path $RepoRoot "THIRD_PARTY_NOTICES.md") -Destination $PackageRoot
Copy-Item -LiteralPath (Join-Path $RepoRoot "third-party") -Destination $PackageRoot -Recurse
if (-not $WhisperBundleDirectory) {
    $WhisperBundleDirectory = Join-Path $OutputRoot 'whisper-bundle'
    & (Join-Path $RepoRoot 'build-whisper.ps1') -OutputDirectory $WhisperBundleDirectory
}
foreach ($Required in @('whisper-cli.exe','ggml-small.en.bin','LICENSE-whisper.cpp.txt','LICENSE-Whisper.txt','manifest.json','whisper.cpp-source.zip')) {
    if (-not (Test-Path -LiteralPath (Join-Path $WhisperBundleDirectory $Required))) { throw "完整包缺少语音组件：$Required" }
}
if ((Get-FileHash -LiteralPath (Join-Path $WhisperBundleDirectory 'ggml-small.en.bin') -Algorithm SHA256).Hash -ne 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d') { throw '语音模型校验失败，拒绝打包' }
Copy-Item -LiteralPath $WhisperBundleDirectory -Destination (Join-Path $PackageRoot 'whisper') -Recurse

# Fail closed if a developer runtime file or an absolute developer path ever
# slips into a release. The portable app creates runtime-data only after launch.
$PrivateRuntimeFiles = Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force -File | Where-Object {
    $_.FullName -match '[\\/](userdata|runtime-data)[\\/]' -or
    $_.Name -in @('config.json', 'EnglishLearnPath-data.json', 'EnglishLearnPath-data.backup.json') -or
    $_.Extension -eq '.dpapi' -or $_.Name -like '.ai-credential-*'
}
if ($PrivateRuntimeFiles) {
    $Names = ($PrivateRuntimeFiles.FullName -join [Environment]::NewLine)
    throw "发布包包含本地运行数据，已停止构建：`n$Names"
}

$TextFiles = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | Where-Object {
    $_.Extension -in @('.md', '.html', '.css', '.js', '.json', '.txt')
}
foreach ($File in $TextFiles) {
    $Content = Get-Content -LiteralPath $File.FullName -Raw
    if ($Content -match '(?i)[A-Z]:\\(?:Users|summary)\\') {
        throw "发布包包含开发机绝对路径，已停止构建：$($File.FullName)"
    }
}

$ZipPath = Join-Path $RepoRoot "dist\EnglishLearnPath-Windows-x64-Full-$Version.zip"
if (Test-Path -LiteralPath $ZipPath) {
    $ZipPath = Join-Path $RepoRoot ("dist\EnglishLearnPath-Windows-x64-Full-$Version-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
}
Compress-Archive -LiteralPath $PackageRoot -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Output $ZipPath
