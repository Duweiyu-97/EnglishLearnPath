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

$ZipPath = Join-Path $OutputRoot "EnglishLearnPath-Windows-x64-$Version.zip"
Compress-Archive -LiteralPath $PackageRoot -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Output $ZipPath
