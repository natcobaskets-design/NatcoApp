# Run from inside your NatcoApp project folder:  powershell -ExecutionPolicy Bypass -File install.ps1
$src = Join-Path $PSScriptRoot ".github"
Copy-Item -Path $src -Destination (Get-Location) -Recurse -Force
Write-Host "Done. Restart VS Code or reload the window (Ctrl+Shift+P > Developer: Reload Window)."
