param(
    [ValidateRange(1024, 65535)][int]$FrontendPort = 5174,
    [ValidateRange(1024, 65535)][int]$BackendPort = 8001,
    [ValidateSet('dev', 'preview')][string]$Mode = 'dev',
    [switch]$WithMusic,
    [ValidateRange(1024, 65535)][int]$MusicPort = 3001,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.dist/local-acceptance'
$statePath = Join-Path $runtimeDir 'processes.json'

function Stop-OwnedProcess($record) {
    $runningProcess = Get-Process -Id $record.Id -ErrorAction SilentlyContinue
    if ($runningProcess -and $runningProcess.StartTime.ToUniversalTime().Ticks -eq [long]$record.StartedUtcTicks) {
        Stop-Process -Id $runningProcess.Id
        Wait-Process -Id $runningProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
}

if ($Stop) {
    if (Test-Path -LiteralPath $statePath) {
        $savedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($record in $savedState.Processes) { Stop-OwnedProcess $record }
        Remove-Item -LiteralPath $statePath
    }
    Write-Output 'Local acceptance services stopped; test data retained.'
    exit
}
if ($FrontendPort -eq $BackendPort) { throw 'Frontend and backend ports must differ.' }
$servicePorts = @($FrontendPort, $BackendPort)
if ($WithMusic) {
    if ($MusicPort -in $servicePorts) { throw 'Music, frontend and backend ports must differ.' }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'music-service/node_modules/@neteasecloudmusicapienhanced/api/package.json'))) {
        throw 'Install music dependencies first: npm --prefix music-service ci --ignore-scripts'
    }
    $servicePorts += $MusicPort
}
foreach ($servicePort in $servicePorts) {
    $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $servicePort)
    try { $portProbe.Start() }
    catch { throw "Port $servicePort is unavailable. Choose another port; no existing process was stopped." }
    finally { $portProbe.Stop() }
}
if (Test-Path -LiteralPath $statePath) {
    $savedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($record in $savedState.Processes) {
        $runningProcess = Get-Process -Id $record.Id -ErrorAction SilentlyContinue
        if ($runningProcess -and $runningProcess.StartTime.ToUniversalTime().Ticks -eq [long]$record.StartedUtcTicks) {
            throw 'An acceptance process is still running. Use -Stop before starting a new session.'
        }
    }
}
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeDir 'uploads') | Out-Null
$pythonExecutable = (Get-Command python -ErrorAction Stop).Source
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$packagesDir = Join-Path $runtimeDir 'python_packages'
if (!(Test-Path -LiteralPath $packagesDir)) {
    throw 'Install dependencies first: python -m pip install -r backend/requirements.txt --target .dist/local-acceptance/python_packages'
}
$environment = @{
    PYTHONPATH = $packagesDir
    PYTHONIOENCODING = 'utf-8'
    BLOG_DATABASE_PATH = (Join-Path $runtimeDir 'blog.db')
    BLOG_UPLOADS_DIR = (Join-Path $runtimeDir 'uploads')
    BLOG_SECRET_KEY = 'isolated-local-acceptance-only'
    CORS_ORIGINS = "http://127.0.0.1:$FrontendPort"
    VITE_API_BASE_URL = '/api'
    BLOG_DEV_API_TARGET = "http://127.0.0.1:$BackendPort"
    BLOG_MUSIC_API_URL = "http://127.0.0.1:$MusicPort"
    BLOG_MUSIC_PORT = "$MusicPort"
}
$previousEnvironment = @{}
$startedProcesses = @()
try {
    foreach ($key in $environment.Keys) {
        $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process')
    }
    & $pythonExecutable -c 'import fastapi, uvicorn, multipart, PIL, pillow_heif'
    if ($LASTEXITCODE -ne 0) { throw 'Python dependencies are incompatible. Reinstall them for the current Python version.' }
    & $pythonExecutable (Join-Path $projectRoot 'scripts/seed_local_acceptance.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare local test data.' }
    if ($Mode -eq 'preview') {
        & npm --prefix (Join-Path $projectRoot 'frontend') run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    }
    if ($WithMusic) {
        $musicProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('server.cjs') -WorkingDirectory (Join-Path $projectRoot 'music-service') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'music.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'music.stderr.log')
        $startedProcesses += $musicProcess
    }
    $backendProcess = Start-Process -FilePath $pythonExecutable -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$BackendPort") -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'backend.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'backend.stderr.log')
    $startedProcesses += $backendProcess
    $frontendArguments = @('node_modules/vite/bin/vite.js')
    if ($Mode -eq 'preview') { $frontendArguments += 'preview' }
    $frontendArguments += @('--host','127.0.0.1','--port',"$FrontendPort",'--strictPort')
    $frontendProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $frontendArguments -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend.stderr.log')
    $startedProcesses += $frontendProcess
    $ready = $false
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        if ($backendProcess.HasExited -or $frontendProcess.HasExited) { throw "A service exited. Inspect logs in $runtimeDir" }
        if ($WithMusic -and $musicProcess.HasExited) { throw "Music service exited. Inspect logs in $runtimeDir" }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$FrontendPort/api/health" -TimeoutSec 2 -NoProxy
            $musicReady = !$WithMusic
            if ($WithMusic) {
                $musicHealth = Invoke-RestMethod "http://127.0.0.1:$MusicPort/health" -TimeoutSec 2 -NoProxy
                $musicReady = $musicHealth.status -eq 'ok'
            }
            if ($health.status -eq 'ok' -and $musicReady) { $ready = $true; break }
        } catch { $lastHealthError = $_.Exception.Message; Start-Sleep -Milliseconds 300 }
    }
    if (!$ready) { throw "Services did not become ready: $lastHealthError. Inspect logs in $runtimeDir" }
    $records = @($startedProcesses | ForEach-Object { @{ Id = $_.Id; StartedUtcTicks = $_.StartTime.ToUniversalTime().Ticks } })
    @{ Frontend = "http://127.0.0.1:$FrontendPort"; Backend = "http://127.0.0.1:$BackendPort"; Mode = $Mode; Processes = $records } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding utf8
    Write-Output "Ready: http://127.0.0.1:$FrontendPort"
    Write-Output 'Stop: .\start-local-acceptance.ps1 -Stop'
} catch {
    foreach ($startedProcess in $startedProcesses) { if (!$startedProcess.HasExited) { Stop-Process -Id $startedProcess.Id -ErrorAction SilentlyContinue } }
    throw
} finally {
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
}
