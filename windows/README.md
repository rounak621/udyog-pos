# UDYOG POS for Windows

`windows/msix/` is a small WinForms + WebView2 shell, packaged as MSIX. It
opens the UDYOG POS cloud web app in a desktop window. It contains no server
and no database.

## Package identity (owner must provide before release)

`AppxManifest.xml` holds tokens only. `build-windows-msix.ps1` fills them from
parameters (and the manual workflow passes its inputs through):

| Parameter | DEV default (fake, not for release) |
|---|---|
| `-IdentityName` | `UDYOG.POS.Dev` |
| `-Publisher` | `CN=UDYOG Dev` |
| `-PublisherDisplayName` | `UDYOG Dev (not for release)` |
| `-Version` | `0.1.0.0` |

For a real release the owner must provide ONE of:

- **Microsoft Store:** the Partner Center "Product identity" values
  (Package/Identity/Name, Package/Identity/Publisher, PublisherDisplayName).
  The Store signs the package on upload.
- **Direct download (sideload):** a code-signing certificate. `-Publisher`
  must equal the certificate Subject exactly. Signing with it is not wired
  up yet; no real secrets are used anywhere in this repo.

`validate-msix.ps1` fails on the DEV identity unless `-AllowDevIdentity` is passed.
