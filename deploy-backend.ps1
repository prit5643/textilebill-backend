param(
  [string]$BackendDir = (Join-Path $PSScriptRoot 'textilebill-backend'),
  [string]$HerokuApp = 'textilebill-api-eu-prod',
  [string]$HealthBaseUrl = 'https://textilebill-api-eu-prod-1a1bb549439a.herokuapp.com',
  [switch]$SkipBuild,
  [switch]$AllowDirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @()
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

Write-Host '==> Validating prerequisites...' -ForegroundColor Cyan
Assert-Command -Name 'git'
Assert-Command -Name 'npm'
Assert-Command -Name 'heroku'
Assert-Command -Name 'robocopy'
Assert-Command -Name 'curl.exe'

if (-not (Test-Path $BackendDir)) {
  throw "Backend directory not found: $BackendDir"
}

Push-Location $BackendDir
try {
  Write-Host '==> Checking git repository state...' -ForegroundColor Cyan
  Invoke-External -Command 'git' -Arguments @('rev-parse', '--is-inside-work-tree')

  if (-not $AllowDirty) {
    $dirty = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
      throw 'Unable to read git status.'
    }
    if ($dirty) {
      throw 'Working tree has uncommitted changes. Commit/stash first or run with -AllowDirty.'
    }
  }

  Write-Host '==> Verifying Heroku authentication...' -ForegroundColor Cyan
  Invoke-External -Command 'heroku' -Arguments @('auth:whoami')

  if (-not $SkipBuild) {
    Write-Host '==> Building backend before deploy...' -ForegroundColor Cyan
    Invoke-External -Command 'npm' -Arguments @('run', 'build')
  }

  $deploymentDir = Join-Path $env:TEMP ("textilebill-backend-deploy-$([guid]::NewGuid().ToString('N'))")
  Write-Host '==> Preparing clean deploy snapshot...' -ForegroundColor Cyan
  New-Item -ItemType Directory -Path $deploymentDir | Out-Null

  try {
    $robocopyArgs = @(
      $BackendDir,
      $deploymentDir,
      '/MIR',
      '/XD',
      '.git',
      'node_modules',
      '.next',
      'out',
      'coverage',
      'dist'
    )

    & robocopy @robocopyArgs | Out-Null
    $robocopyCode = $LASTEXITCODE
    if ($robocopyCode -gt 7) {
      throw "robocopy failed with exit code $robocopyCode"
    }

    Push-Location $deploymentDir
    try {
      Invoke-External -Command 'git' -Arguments @('init')
      Invoke-External -Command 'git' -Arguments @('config', 'user.name', 'TextileBill Deploy Bot')
      Invoke-External -Command 'git' -Arguments @('config', 'user.email', 'deploy-bot@localhost')
      Invoke-External -Command 'heroku' -Arguments @('git:remote', '-a', $HerokuApp)
      Invoke-External -Command 'git' -Arguments @('add', '-A')
      Invoke-External -Command 'git' -Arguments @('commit', '-m', 'Deploy snapshot')

      Write-Host "==> Deploying backend to Heroku app '$HerokuApp'..." -ForegroundColor Cyan
      Invoke-External -Command 'git' -Arguments @('push', '--force', 'heroku', 'HEAD:main')
    }
    finally {
      Pop-Location
    }
  }
  finally {
    if (Test-Path $deploymentDir) {
      Remove-Item -Path $deploymentDir -Recurse -Force
    }
  }
}
finally {
  Pop-Location
}

$healthUrl = "$HealthBaseUrl/api/health"
Write-Host "==> Verifying backend health: $healthUrl" -ForegroundColor Cyan
$statusCode = (& curl.exe -s -o NUL -w '%{http_code}' $healthUrl)
if ([int]$statusCode -lt 200 -or [int]$statusCode -ge 400) {
  throw "Backend health check failed for $healthUrl with HTTP status $statusCode"
}

Write-Host "Backend deploy complete. Health check passed with HTTP $statusCode." -ForegroundColor Green