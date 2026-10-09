# Updates the Ubif-nextgen-plus Chrome extension from GitHub.
# Downloads the repo ZIP and extracts it straight into Documents,
# which creates or overwrites Documents\Ubif-nextgen-plus-main
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$zipUrl = 'https://github.com/dotjarden/Ubif-nextgen-plus/archive/refs/heads/main.zip'
$docs   = [Environment]::GetFolderPath('MyDocuments')
$zip    = Join-Path $docs 'Ubif-nextgen-plus-main.zip'
$log    = Join-Path $docs 'ubif-update-log.txt'

try {
    # 1. Download the ZIP into Documents
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing

    # 2. Unzip into Documents. The ZIP contains one folder named
    #    Ubif-nextgen-plus-main, so this overwrites the existing folder's files.
    Expand-Archive -Path $zip -DestinationPath $docs -Force

    # 3. Clean up the ZIP
    Remove-Item $zip -Force

    $manifest = Join-Path $docs 'Ubif-nextgen-plus-main\extension\manifest.json'
    $version  = (Get-Content $manifest -Raw | ConvertFrom-Json).version
    Add-Content $log "$(Get-Date -Format s)  Update OK, version $version"
}
catch {
    Add-Content $log "$(Get-Date -Format s)  Update FAILED: $_"
    exit 1
}
exit 0
