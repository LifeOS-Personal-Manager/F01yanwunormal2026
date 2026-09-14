$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Npm = (Get-Command npm.cmd).Source

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Missing .venv. Run: python -m venv .venv"
}

$Api = Start-Process -FilePath $Python -ArgumentList "-m", "uvicorn", "apps.api.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
$Web = Start-Process -FilePath $Npm -ArgumentList "run", "dev", "--", "--host", "127.0.0.1" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru

Write-Host "Yanwu is running:"
Write-Host "  Web: http://127.0.0.1:5173"
Write-Host "  API: http://127.0.0.1:8000/docs"
Write-Host "Process IDs: web=$($Web.Id), api=$($Api.Id)"
