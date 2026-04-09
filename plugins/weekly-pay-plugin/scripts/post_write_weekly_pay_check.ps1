$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$requiredFiles = @(
  "index.html",
  "auth.js",
  "finance.js"
)

$missing = @()
foreach ($file in $requiredFiles) {
  $full = Join-Path $root "..\$file"
  if (-not (Test-Path $full)) {
    $missing += $file
  }
}

if ($missing.Count -gt 0) {
  Write-Output ("Weekly Pay hook check: missing expected files: " + ($missing -join ", "))
  exit 0
}

Write-Output "Weekly Pay hook check: core files detected."
exit 0
