param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist\whisper-bundle'), [string]$SourceArchive = '', [string]$ModelPath = '')
$ErrorActionPreference = 'Stop'
$Revision = '371b5a7561823ab2bb32142d2751e35e7534727b'
$ModelHash = 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d'
$SourceUrl = "https://codeload.github.com/ggml-org/whisper.cpp/zip/$Revision"
$ModelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
$Work = Join-Path $PSScriptRoot ('dist\whisper-build-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory already exists; choose a fresh directory. No files have been removed.' }
New-Item -ItemType Directory -Path $Work,$OutputDirectory | Out-Null
$Archive = Join-Path $Work 'whisper-source.zip'
if ($SourceArchive) { Copy-Item -LiteralPath $SourceArchive -Destination $Archive }
else { Invoke-WebRequest -Uri $SourceUrl -OutFile $Archive -TimeoutSec 600 }
Expand-Archive -LiteralPath $Archive -DestinationPath $Work
$Source = Join-Path $Work "whisper.cpp-$Revision"
$Build = Join-Path $Work 'build'
# Static MSVC runtime and libraries: no Python, VC redistributable or GPU SDK
# is required on the end user's machine. Disable build-machine CPU tuning.
& cmake -S $Source -B $Build -G 'Visual Studio 17 2022' -A x64 '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW' '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded' '-DBUILD_SHARED_LIBS=OFF' '-DGGML_NATIVE=OFF' '-DGGML_AVX=OFF' '-DGGML_AVX2=OFF' '-DGGML_FMA=OFF' '-DGGML_F16C=OFF' '-DGGML_OPENMP=OFF' '-DWHISPER_BUILD_TESTS=OFF' '-DWHISPER_BUILD_SERVER=OFF'
if ($LASTEXITCODE -ne 0) { throw 'whisper.cpp configuration failed' }
& cmake --build $Build --config Release --target whisper-cli -j 4
if ($LASTEXITCODE -ne 0) { throw 'whisper.cpp build failed' }
$Binary = Get-ChildItem -LiteralPath $Build -Recurse -Filter whisper-cli.exe | Select-Object -First 1
if (-not $Binary) { throw 'whisper-cli.exe not produced' }
Copy-Item -LiteralPath $Binary.FullName -Destination (Join-Path $OutputDirectory 'whisper-cli.exe')
$Dumpbin = Get-ChildItem "${env:ProgramFiles}\Microsoft Visual Studio\2022\*\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $Dumpbin) { throw 'dumpbin is required to verify dependency-free packaging' }
$Dependencies = & $Dumpbin.FullName /dependents $Binary.FullName
if ($LASTEXITCODE -ne 0 -or ($Dependencies -join "`n") -match '(?i)(VCRUNTIME|MSVCP|vcomp|libomp|ggml|whisper)\S*\.dll') { throw 'Engine has non-system DLL dependencies; full portable package rejected' }
$Model = Join-Path $OutputDirectory 'ggml-small.en.bin'
if ($ModelPath) { Copy-Item -LiteralPath $ModelPath -Destination $Model }
else { Invoke-WebRequest -Uri $ModelUrl -OutFile $Model -TimeoutSec 1200 }
if ((Get-FileHash -LiteralPath $Model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ModelHash) { throw 'Model SHA256 mismatch; bundle rejected' }
Copy-Item -LiteralPath (Join-Path $Source 'LICENSE') -Destination (Join-Path $OutputDirectory 'LICENSE-whisper.cpp.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'third-party\LICENSE-Whisper.txt') -Destination $OutputDirectory
# Preserve all upstream embedded vendor notices alongside the exact source.
Copy-Item -LiteralPath $Archive -Destination (Join-Path $OutputDirectory 'whisper.cpp-source.zip')
@{engine='whisper.cpp'; revision=$Revision; source=$SourceUrl; model='small.en'; modelSource=$ModelUrl; modelSHA256=$ModelHash; engineSHA256=(Get-FileHash -LiteralPath (Join-Path $OutputDirectory 'whisper-cli.exe') -Algorithm SHA256).Hash.ToLowerInvariant(); runtime='static MSVC, CPU, no external DLLs'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'manifest.json') -Encoding utf8
Write-Output "WHISPER_BUNDLE=$OutputDirectory"
