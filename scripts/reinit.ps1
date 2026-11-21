# reinit.ps1 – Windows wrapper for reinit.sh
# Runs the bash script via Git Bash (Docker Desktop CLI, Windows networking).
# Usage: .\scripts\reinit.ps1

$gitBash = "C:\Program Files\Git\bin\bash.exe"

if (-not (Test-Path $gitBash)) {
    Write-Error "Git Bash not found at: $gitBash`nInstall Git for Windows: https://git-scm.com/download/win"
    exit 1
}

$script = Join-Path $PSScriptRoot "reinit.sh"
& $gitBash $script @args
exit $LASTEXITCODE
