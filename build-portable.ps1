param(
    [string]$Version = "dev"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputRoot = Join-Path $RepoRoot "dist"
$PackageRoot = Join-Path $OutputRoot "EnglishLearnPath-Windows-x64"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "开发者构建需要 Go 1.22 或更高版本。普通使用者请直接下载 GitHub Releases 中的 ZIP。"
}

if (Test-Path -LiteralPath $OutputRoot) {
    Remove-Item -LiteralPath $OutputRoot -Recurse -Force
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

# Fail closed if a developer runtime file or an absolute developer path ever
# slips into a release. The portable app creates runtime-data only after launch.
$PrivateRuntimeFiles = Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force -File | Where-Object {
    $_.FullName -match '[\\/](userdata|runtime-data)[\\/]' -or
    $_.Name -in @('config.json', 'EnglishLearnPath-data.json', 'EnglishLearnPath-data.backup.json')
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

$ZipPath = Join-Path $OutputRoot "EnglishLearnPath-Windows-x64-$Version.zip"
Compress-Archive -LiteralPath $PackageRoot -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Output $ZipPath
