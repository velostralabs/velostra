param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production'
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

foreach ($name in @('telegram-bot-token', 'telegram-chat-id')) {
  & $gcloud secrets describe $name ('--project=' + $ProjectId) '--format=value(name)' |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Telegram Secret Manager containers must be bootstrapped first'
  }
}

function Add-SecretVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

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
  try {
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $null = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw ('Unable to store ' + $Name + ': ' + $stderr.Trim())
    }
  } finally {
    if (-not $process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
}

$secure = Read-Host 'Enter the BotFather token for the dedicated Velostra alert bot' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$botToken = $null
$client = $null
try {
  $botToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ($botToken -notmatch '^\d{5,20}:[A-Za-z0-9_-]{30,}$') {
    throw 'Telegram bot token format is invalid'
  }

  $client = [Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(15)

  function Invoke-Telegram {
    param(
      [Parameter(Mandatory = $true)][string]$Method,
      [Parameter(Mandatory = $true)][hashtable]$Body
    )

    $uri = 'https://api.telegram.org/bot' + $botToken + '/' + $Method
    $json = $Body | ConvertTo-Json -Compress -Depth 5
    $content = [Net.Http.StringContent]::new(
      $json,
      [Text.Encoding]::UTF8,
      'application/json'
    )
    $response = $null
    try {
      try {
        $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
        $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      } catch {
        throw 'Telegram request failed without exposing credentials'
      }
      if (-not $response.IsSuccessStatusCode) {
        throw ('Telegram returned HTTP ' + [int]$response.StatusCode)
      }
      $payload = $responseText | ConvertFrom-Json
      if (-not $payload.ok) { throw 'Telegram rejected the request' }
      return $payload.result
    } finally {
      $content.Dispose()
      if ($null -ne $response) { $response.Dispose() }
    }
  }

  $updates = @(Invoke-Telegram -Method 'getUpdates' -Body @{
    timeout = 0
    allowed_updates = @('channel_post')
  })
  $channelPost = $null
  foreach ($update in $updates) {
    $property = $update.PSObject.Properties['channel_post']
    if ($null -ne $property -and $null -ne $property.Value) {
      $channelPost = $property.Value
    }
  }
  if ($null -eq $channelPost) {
    throw 'Post one fresh message in the private channel, then run this helper again'
  }
  $chatId = [string]$channelPost.chat.id
  $usernameProperty = $channelPost.chat.PSObject.Properties['username']
  $hasPublicUsername = $null -ne $usernameProperty -and
    -not [string]::IsNullOrWhiteSpace([string]$usernameProperty.Value)
  if ($channelPost.chat.type -ne 'channel' -or
      $chatId -notmatch '^-100\d{5,16}$' -or
      $hasPublicUsername) {
    throw 'The latest Telegram update is not from a private channel'
  }

  $null = Invoke-Telegram -Method 'sendMessage' -Body @{
    chat_id = $chatId
    text = 'Velostra staging alert transport connected. No runtime or paid flow was activated.'
    disable_web_page_preview = $true
    disable_notification = $false
  }

  Add-SecretVersion -Name 'telegram-chat-id' -Value $chatId
  Add-SecretVersion -Name 'telegram-bot-token' -Value $botToken
  Write-Output 'Telegram private-channel delivery verified and both credentials stored securely.'
} finally {
  $botToken = $null
  if ($null -ne $client) { $client.Dispose() }
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
