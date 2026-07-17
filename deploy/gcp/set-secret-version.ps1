param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'database-url',
    'redis-url',
    'jwt-secret',
    'gateway-hmac-secret',
    'platform-cursor-secret',
    'agent-secret-encryption-key',
    'metrics-auth-token',
    'signer-auth-token',
    'primary-rpc-url',
    'fallback-rpc-urls',
    'alert-webhook-url',
    'alert-webhook-token'
  )]
  [string]$Name,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-staging-us'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

& $gcloud secrets describe $Name ('--project=' + $ProjectId) '--format=value(name)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Secret container does not exist: ' + $Name }

$secure = Read-Host ('Enter value for ' + $Name) -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = $null
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrEmpty($plain)) { throw 'Secret value cannot be empty' }

  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $env:ComSpec
  $quotedGcloud = '"' + $gcloud + '"'
  $start.Arguments = '/d /s /c "' + $quotedGcloud +
    ' secrets versions add ' + $Name +
    ' --project=' + $ProjectId + ' --data-file=-"'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($start)
  $process.StandardInput.Write($plain)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw 'Unable to add secret version: ' + $stderr.Trim()
  }
  Write-Output $stdout.Trim()
  Write-Output ('Secret version added without placing ' + $Name + ' in command history or a file.')
} finally {
  $plain = $null
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
