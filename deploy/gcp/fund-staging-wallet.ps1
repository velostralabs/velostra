param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PrivateRoot = Join-Path $RepositoryRoot 'artifacts\staging\evidence\private'
$WalletPath = Join-Path $PrivateRoot 'reconciliation-wallet.dpapi.json'
$VaultPath = Join-Path $PrivateRoot 'metamask-vault.dpapi.json'
$ExtensionPath = Join-Path $PrivateRoot 'metamask-extension'
$ProfilePath = Join-Path $PrivateRoot 'metamask-dedicated-profile-v6'

function Unprotect-Record([string]$Path, [string]$Purpose, [string]$EntropyText) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Missing encrypted $Purpose record" }
  $record = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ($record.productionEligible -ne $false -or $record.encryption -ne 'DPAPI-CurrentUser') {
    throw "Unsafe $Purpose record metadata"
  }
  $ciphertext = [Convert]::FromBase64String([string]$record.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes($EntropyText)
  try {
    return [Security.Cryptography.ProtectedData]::Unprotect(
      $ciphertext,
      $entropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
  } finally {
    [Array]::Clear($ciphertext, 0, $ciphertext.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
  }
}

if (-not $Apply) {
  Write-Output 'PLAN open the official Robinhood Chain testnet faucet with the isolated MetaMask profile'
  Write-Output 'PLAN verify the connected account internally and request only public testnet tokens'
  Write-Output 'No faucet request sent. Pass -Apply after explicit approval.'
  exit 0
}

if (-not (Test-Path -LiteralPath $ExtensionPath) -or -not (Test-Path -LiteralPath $ProfilePath)) {
  throw 'The dedicated MetaMask extension and profile are required'
}

$dirty = (& git -C $RepositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked worktree must be clean before a faucet request' }

$walletBytes = $null
$vaultBytes = $null
try {
  $walletBytes = Unprotect-Record $WalletPath 'staging wallet' 'Velostra:staging-evidence:v1:reconciliation-wallet'
  $vaultBytes = Unprotect-Record $VaultPath 'MetaMask vault' 'Velostra:staging-evidence:v1:metamask-vault'
  if ($walletBytes.Length -ne 32 -or $vaultBytes.Length -lt 12) { throw 'Encrypted staging material is malformed' }

  $env:VELOSTRA_FAUCET_APPROVAL = 'isolated-staging-faucet-approved'
  $env:EVIDENCE_WALLET_PRIVATE_KEY = '0x' + (($walletBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  $env:METAMASK_VAULT_PASSWORD = [Text.Encoding]::UTF8.GetString($vaultBytes)
  $env:METAMASK_EXTENSION_PATH = $ExtensionPath
  $env:METAMASK_USER_DATA_DIR = $ProfilePath
  Push-Location $RepositoryRoot
  try {
    & node 'scripts/run-testnet-faucet.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Official testnet faucet request failed' }
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:VELOSTRA_FAUCET_APPROVAL -ErrorAction SilentlyContinue
  Remove-Item Env:EVIDENCE_WALLET_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:METAMASK_VAULT_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:METAMASK_EXTENSION_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:METAMASK_USER_DATA_DIR -ErrorAction SilentlyContinue
  if ($walletBytes) { [Array]::Clear($walletBytes, 0, $walletBytes.Length) }
  if ($vaultBytes) { [Array]::Clear($vaultBytes, 0, $vaultBytes.Length) }
}
