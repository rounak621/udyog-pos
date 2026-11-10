#Requires -Version 7.0
<#
.SYNOPSIS
  Builds and packages the UDYOG POS Windows MSIX client. Windows-only:
  needs the .NET 8 SDK and the Windows 10/11 SDK (makeappx.exe, signtool.exe).
  The reference build is the manual GitHub Actions workflow windows-msix.yml.

.DESCRIPTION
    1. `dotnet publish` the WinForms shell (self-contained win-x64 folder).
    2. Stage the output + Assets/ + AppxManifest.xml (identity tokens filled
       in from the parameters below).
    3. `makeappx pack` into out/UDYOGPOS.msix.
    4. Optionally sign with a throwaway self-signed TEST cert and install it.

.PARAMETER IdentityName
  MSIX Identity/@Name. Default is a fake DEV value. For a Store release use
  the Partner Center "Package/Identity/Name".

.PARAMETER Publisher
  MSIX Identity/@Publisher. Must equal the signing certificate Subject (or
  the Partner Center "Package/Identity/Publisher"). Default is a fake DEV value.

.PARAMETER PublisherDisplayName
  Shown by Windows as the publisher. Default is a fake DEV value.

.PARAMETER Version
  Package and app version, Major.Minor.Build.Revision.

.PARAMETER DefaultServerUrl
  Optional https origin that pre-fills the first-run server form
  (MSBuild property DefaultServerUrl). Empty = blank form.

.PARAMETER SelfSignedTest
  Signs with a throwaway self-signed cert under
  $env:LOCALAPPDATA\UDYOGPOS\dev-cert and trusts it for the current user.
  LOCAL/CI TEST INSTALLS ONLY.

.PARAMETER InstallLocally
  After -SelfSignedTest, installs the package with Add-AppxPackage.

.EXAMPLE
  ./build-windows-msix.ps1 -SelfSignedTest -InstallLocally
#>
param(
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',

    [ValidateSet('x64')]
    [string]$Platform = 'x64',

    [string]$IdentityName = 'UDYOG.POS.Dev',

    [string]$Publisher = 'CN=UDYOG Dev',

    [string]$PublisherDisplayName = 'UDYOG Dev (not for release)',

    [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')]
    [string]$Version = '0.1.0.0',

    [string]$DefaultServerUrl = '',

    [switch]$SelfSignedTest,

    [switch]$InstallLocally
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path   # windows/msix
$launcherProj = Join-Path $root 'Launcher/Launcher.csproj'
$manifestSrc = Join-Path $root 'AppxManifest.xml'
$assetsSrc = Join-Path $root 'Assets'
$publishDir = Join-Path $root 'out/publish'
$stageDir = Join-Path $root 'out/stage'
$msixOut = Join-Path $root 'out/UDYOGPOS.msix'

Write-Host "== UDYOG POS Windows MSIX build ==" -ForegroundColor Cyan
Write-Host "Configuration=$Configuration Platform=$Platform Version=$Version" -ForegroundColor Cyan
Write-Host "Identity=$IdentityName Publisher=$Publisher" -ForegroundColor Cyan

foreach ($tool in 'dotnet', 'makeappx') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH. Install the .NET 8 SDK and the Windows 10/11 SDK."
    }
}

# --- 1. Publish the WinForms shell ------------------------------------------
Remove-Item -Recurse -Force $publishDir, $stageDir, $msixOut -ErrorAction SilentlyContinue
$publishArgs = @($launcherProj, '-c', $Configuration, '-r', "win-$Platform", '-o', $publishDir, "-p:Version=$Version")
if ($DefaultServerUrl) { $publishArgs += "-p:DefaultServerUrl=$DefaultServerUrl" }
& dotnet publish @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

$exePath = Join-Path $publishDir 'UDYOGPOS.exe'
if (-not (Test-Path $exePath)) { throw "Publish succeeded but UDYOGPOS.exe was not found at $exePath" }

# --- 2. Stage the package layout --------------------------------------------
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Copy-Item -Path (Join-Path $publishDir '*') -Destination $stageDir -Recurse -Force
Copy-Item -Path $assetsSrc -Destination (Join-Path $stageDir 'Assets') -Recurse -Force

# Fill the identity tokens. XML-escape the values (a Publisher CN may hold
# characters such as '&' or quotes).
$esc = { param($v) [System.Security.SecurityElement]::Escape($v) }
$manifestText = Get-Content $manifestSrc -Raw
$manifestText = $manifestText.
    Replace('__IDENTITY_NAME__', (& $esc $IdentityName)).
    Replace('__PUBLISHER_DISPLAY_NAME__', (& $esc $PublisherDisplayName)).
    Replace('__PUBLISHER__', (& $esc $Publisher)).
    Replace('__VERSION__', $Version)
if ($manifestText -match '__[A-Z_]+__"|>__[A-Z_]+__<') { throw "AppxManifest.xml still has an unreplaced __TOKEN__" }
$stagedManifest = Join-Path $stageDir 'AppxManifest.xml'
Set-Content -Path $stagedManifest -Value $manifestText -Encoding utf8NoBOM

# Never ship .pdb debug symbols inside the package.
Get-ChildItem -Path $stageDir -Filter '*.pdb' -Recurse -File | Remove-Item -Force

# --- 3. Pack ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path (Split-Path $msixOut) | Out-Null
& makeappx pack /d $stageDir /p $msixOut /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed with exit code $LASTEXITCODE" }
Write-Host "Built package: $msixOut" -ForegroundColor Green

# --- 4. Optional: sign with a throwaway local test certificate -------------
if ($SelfSignedTest) {
    if (-not (Get-Command signtool -ErrorAction SilentlyContinue)) {
        throw "signtool not found on PATH; install the Windows 10/11 SDK."
    }
    $certDir = Join-Path $env:LOCALAPPDATA 'UDYOGPOS\dev-cert'
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    $pfxPath = Join-Path $certDir 'udyogpos-dev.pfx'
    $cerPath = Join-Path $certDir 'udyogpos-dev.cer'
    $pfxPassword = 'udyogpos-dev'   # throwaway test cert only

    # The signing cert Subject must equal Identity/@Publisher.
    $subject = $Publisher
    $existing = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) } |
        Select-Object -First 1

    if (-not $existing) {
        Write-Host "Generating throwaway self-signed test cert ($subject)..." -ForegroundColor Yellow
        $existing = New-SelfSignedCertificate `
            -Type Custom `
            -Subject $subject `
            -KeyUsage DigitalSignature `
            -FriendlyName "UDYOG POS dev-only test cert" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
        $pwd = ConvertTo-SecureString -String $pfxPassword -Force -AsPlainText
        Export-PfxCertificate -Cert $existing -FilePath $pfxPath -Password $pwd | Out-Null
        Export-Certificate -Cert $existing -FilePath $cerPath | Out-Null
        # A self-signed cert is its own root: MSIX install needs it trusted
        # as a root (LocalMachine\Root needs admin) and in TrustedPeople.
        Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
        try {
            Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\LocalMachine\Root -ErrorAction Stop | Out-Null
        } catch {
            Write-Host "WARNING: could not import test cert into LocalMachine\Root ($($_.Exception.Message)); run as Administrator or install will fail with 0x800B0109." -ForegroundColor Yellow
        }
    }
    elseif (-not (Test-Path $pfxPath)) {
        throw "Found cert '$subject' in the store but no .pfx at $pfxPath; delete the cert from Cert:\CurrentUser\My and re-run."
    }

    & signtool sign /fd SHA256 /a /f $pfxPath /p $pfxPassword $msixOut
    if ($LASTEXITCODE -ne 0) { throw "signtool sign failed with exit code $LASTEXITCODE" }
    # Testers must trust this .cer before installing the test package.
    if (Test-Path $cerPath) { Copy-Item $cerPath (Join-Path $root 'out/udyogpos-dev.cer') -Force }
    Write-Host "Signed with dev-only test certificate." -ForegroundColor Green
}
else {
    Write-Host "Built UNSIGNED package. Sideload installs need a signed package (-SelfSignedTest for local tests)." -ForegroundColor Yellow
}

# --- 5. Optional: local install --------------------------------------------
if ($InstallLocally) {
    if (-not $SelfSignedTest) {
        throw "-InstallLocally requires -SelfSignedTest (Windows refuses to install an unsigned package)."
    }
    Add-AppxPackage -Path $msixOut -ErrorAction Stop
    $installed = Get-AppxPackage -Name $IdentityName
    if (-not $installed) { throw "Add-AppxPackage reported success but Get-AppxPackage found nothing." }
    Write-Host "Installed: $($installed.PackageFullName)" -ForegroundColor Green
    Write-Host "Remove with: Remove-AppxPackage -Package '$($installed.PackageFullName)'" -ForegroundColor Cyan
}

Write-Host "Done." -ForegroundColor Green
