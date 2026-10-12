# Updates a ZIP installation of UBIF NextGen Plus from GitHub.
#
# Run this script from the scripts folder of the installation it should update,
# for example Documents\Ubif-nextgen-plus-main\scripts\update-ubif-extension.ps1.
# It updates the folder one level up (the installation root), wherever that is.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$zipUrl = 'https://github.com/dotjarden/Ubif-nextgen-plus/archive/refs/heads/main.zip'
$root   = Split-Path -Parent $PSScriptRoot
$log    = Join-Path $root 'ubif-update-log.txt'
$work   = Join-Path $env:TEMP ('ubif-update-' + [guid]::NewGuid().ToString('N'))

function Write-Log([string]$message) {
    Add-Content -Path $log -Value "$(Get-Date -Format s)  $message"
}

try {
    # Refuse to run anywhere except the scripts folder of an installation,
    # so a copy saved somewhere else cannot overwrite an unrelated folder.
    if (-not (Test-Path (Join-Path $root 'extension\manifest.json'))) {
        throw "No extension\manifest.json found in $root. Run this script from the scripts folder of your installation."
    }

    # Git checkouts update with `npm run update` or `git pull --ff-only`.
    if (Test-Path (Join-Path $root '.git')) {
        throw "$root is a Git checkout. Use 'npm run update' or 'git pull --ff-only' instead."
    }

    # 1. Download and extract the latest main branch into a temporary folder
    New-Item -ItemType Directory -Path $work | Out-Null
    $zip = Join-Path $work 'main.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $work -Force

    # The ZIP holds a single top-level folder (Ubif-nextgen-plus-main)
    $src = Get-ChildItem -Path $work -Directory | Select-Object -First 1
    if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'extension\manifest.json'))) {
        throw 'The downloaded ZIP does not contain extension\manifest.json.'
    }

    # 2. Copy new and changed files over the installation
    robocopy $src.FullName $root /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

    $version = (Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json).version
    Write-Log "Update OK, version $version"
}
catch {
    Write-Log "Update FAILED: $_"
    exit 1
}
finally {
    if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

exit 0
