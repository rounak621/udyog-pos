#Requires -Version 5.1
<#
.SYNOPSIS
    Structural checks on a built UDYOGPOS.msix: manifest identity, minimal
    capabilities, no dev artifacts, executable and assets present.

.PARAMETER MsixPath
    Path to the .msix. Defaults to ./out/UDYOGPOS.msix.

.PARAMETER AllowDevIdentity
    Downgrades the "still the fake DEV identity" check to a warning. Use it
    only for CI/local self-signed test builds.

.EXAMPLE
    ./validate-msix.ps1 -AllowDevIdentity
#>
[CmdletBinding()]
param(
    [string]$MsixPath = (Join-Path $PSScriptRoot 'out\UDYOGPOS.msix'),
    [switch]$AllowDevIdentity
)

$ErrorActionPreference = 'Stop'
$failures = @()
$warnings = @()

function Test-Check {
    param([string]$Name, [scriptblock]$Body)
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        & $Body
        Write-Host "    PASS" -ForegroundColor Green
    } catch {
        Write-Host "    FAIL: $($_.Exception.Message)" -ForegroundColor Red
        $script:failures += "$Name`: $($_.Exception.Message)"
    }
}

if (-not (Test-Path $MsixPath)) {
    throw "Package not found at $MsixPath. Run build-windows-msix.ps1 first, or pass -MsixPath."
}
Write-Host "Validating: $MsixPath`n" -ForegroundColor White

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("udyogpos-validate-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
try {
    $zipPath = Join-Path $tempDir 'package.zip'
    Copy-Item $MsixPath $zipPath
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempDir)

    Write-Host "Enumerating package contents..." -ForegroundColor DarkGray
    $allFiles = Get-ChildItem -Path $tempDir -Recurse -File -ErrorAction SilentlyContinue
    $allDirs = Get-ChildItem -Path $tempDir -Recurse -Directory -ErrorAction SilentlyContinue
    Write-Host "  $($allFiles.Count) files, $($allDirs.Count) directories" -ForegroundColor DarkGray

    $manifestPath = Join-Path $tempDir 'AppxManifest.xml'
    [xml]$manifest = $null

    Test-Check "AppxManifest.xml present and parses" {
        if (-not (Test-Path $manifestPath)) { throw "AppxManifest.xml missing from package root" }
        $script:manifest = [xml](Get-Content $manifestPath)
    }

    Test-Check "Package identity is not the fake DEV identity" {
        $identity = $manifest.Package.Identity
        if ([string]::IsNullOrWhiteSpace($identity.Publisher)) { throw "Publisher is empty" }
        if ($identity.Publisher -eq 'CN=UDYOG Dev' -or $identity.Name -eq 'UDYOG.POS.Dev') {
            if ($AllowDevIdentity) {
                $script:warnings += "Package uses the fake DEV identity; fine for a test build, never for release."
            } else {
                throw "Package uses the fake DEV identity; pass the real identity to build-windows-msix.ps1 (or -AllowDevIdentity for a test build)"
            }
        }
    }

    Test-Check "Package identity (Name/Version/Architecture) is well-formed" {
        $identity = $manifest.Package.Identity
        if ([string]::IsNullOrWhiteSpace($identity.Name)) { throw "Identity Name is empty" }
        if ($identity.Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
            throw "Version '$($identity.Version)' is not in required Major.Minor.Build.Revision form"
        }
        if ($identity.ProcessorArchitecture -ne 'x64') {
            throw "ProcessorArchitecture is '$($identity.ProcessorArchitecture)', expected x64"
        }
    }

    Test-Check "Declared capabilities are on the minimal allow-list" {
        $allowed = @('internetClient', 'runFullTrust')
        $ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
        $ns.AddNamespace('a', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
        $ns.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
        $capNodes = $manifest.SelectNodes('//a:Capabilities/*', $ns)
        if ($capNodes.Count -eq 0) { throw "No <Capabilities> declared — expected at least internetClient" }
        $declared = @()
        foreach ($node in $capNodes) {
            # Use LocalName, not Name: PowerShell's XML adapter lets an
            # attribute literally called "Name" (every Capability element
            # has one) shadow XmlElement's real .Name property, so
            # $node.Name here returns the attribute VALUE (e.g.
            # "internetClient") instead of the tag name ("Capability").
            # LocalName has no such conflict and also strips any rescap:
            # prefix on its own, so a single check covers both.
            $capName = $node.LocalName
            if ($capName -ne 'Capability') {
                throw "Unexpected capability element '$capName' — only Capability/rescap:Capability are expected"
            }
            $declared += $capName
            $nameAttr = $node.GetAttribute('Name')
            if ($allowed -notcontains $nameAttr) {
                throw "Capability '$nameAttr' is not on the minimal allow-list ($($allowed -join ', ')). If this is intentional, update this script's allow-list AND document why in AppxManifest.xml."
            }
        }
    }

    Test-Check "No USB/device/driver capabilities present" {
        $forbidden = 'usb|serialCommunication|bluetooth|pointOfService|deviceUnlock|broadFileSystemAccess|documentsLibrary'
        $raw = Get-Content $manifestPath -Raw
        # Strip XML comments first — AppxManifest.xml documents, in a
        # comment, exactly which device capabilities are deliberately NOT
        # requested, and a raw-text match matches that explanation too.
        $rawNoComments = [regex]::Replace($raw, '<!--.*?-->', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($rawNoComments -match $forbidden) {
            throw "Manifest references a forbidden capability/keyword matching /$forbidden/ — Windows client must not request raw device access (see hardening brief section 2/17)"
        }
    }

    Test-Check "No development/build/secret artifacts shipped" {
        $forbiddenFilePatterns = @(
            '*.pdb', '*.env', '.env*', '*.ts', '*.tsx', '*.cs', '*.csproj',
            'docker-compose*.yml', 'package.json', 'pnpm-lock.yaml',
            'appsettings.*.json'
        )
        $forbiddenDirNames = @('node_modules', '.git', 'test', 'tests', '__tests__')
        $scopeFiles = $allFiles
        $scopeDirs = $allDirs
        $fileHits = $scopeFiles | Where-Object { $name = $_.Name; ($forbiddenFilePatterns | Where-Object { $name -like $_ }).Count -gt 0 }
        $dirHits = $scopeDirs | Where-Object { $forbiddenDirNames -contains $_.Name }
        $hits = @($fileHits) + @($dirHits)
        if ($hits.Count -gt 0) {
            $names = ($hits | Select-Object -First 10 -ExpandProperty FullName) -join "; "
            throw "Found $($hits.Count) forbidden dev/build artifact(s) in the package: $names"
        }
    }

    Test-Check "Launcher executable and WebView2Loader.dll are present" {
        if (-not ($allFiles | Where-Object Name -eq 'UDYOGPOS.exe')) { throw "UDYOGPOS.exe not found in package — publish/staging likely failed silently" }
        if (-not ($allFiles | Where-Object Name -eq 'WebView2Loader.dll')) { throw "WebView2Loader.dll not found — the launcher will fail at runtime with no native WebView2 loader present" }
    }

    Test-Check "Required visual assets are present" {
        $required = @('Square150x150Logo.png', 'Square44x44Logo.png', 'StoreLogo.png', 'SplashScreen.png')
        $presentNames = $allFiles | Where-Object { $required -contains $_.Name } | Select-Object -ExpandProperty Name -Unique
        foreach ($name in $required) {
            if ($presentNames -notcontains $name) { throw "Missing required asset: $name" }
        }
    }

    if (Get-Command signtool -ErrorAction SilentlyContinue) {
        Write-Host "==> Signature check (signtool verify /pa)" -ForegroundColor Cyan
        & signtool verify /pa $MsixPath 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    PASS: package is signed with a chain signtool trusts" -ForegroundColor Green
        } else {
            Write-Host "    UNSIGNED or untrusted signature (exit $LASTEXITCODE) — expected for a local Developer-Mode test build; must be resolved before Store submission" -ForegroundColor Yellow
            $warnings += "Package is unsigned or has an untrusted signature — fine for local sideload testing with Developer Mode, not for Store submission or production sideload."
        }
    } else {
        $warnings += "signtool not found on PATH — signature was not checked. Install the Windows 10/11 SDK to enable this check."
    }

} finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

Write-Host ""
if ($warnings.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

if ($failures.Count -gt 0) {
    Write-Host "`n$($failures.Count) check(s) FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "`nAll structural checks passed." -ForegroundColor Green
Write-Host "This script does NOT replace the Windows App Certification Kit (WACK) or actual install/launch/print testing on real Windows hardware — see README.md `"Testing`" section." -ForegroundColor Yellow
# Explicit exit 0: without this, the process exit code falls back to
# whatever $LASTEXITCODE was left by the last native tool invocation
# (signtool verify, which legitimately returns nonzero for an expected
# unsigned test build) even though every check above actually passed.
exit 0
