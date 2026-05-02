param(
  [string]$Name = "OmniAgentGateway",
  [string]$Cwd = (Get-Location).Path,
  [string]$StorageRoot = "$env:USERPROFILE\.omni-agent",
  [int]$Port = 4040
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $repoRoot "dist\omni-agent.js"
$taskAction = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" serve --cwd `"$Cwd`" --storage-root `"$StorageRoot`" --port $Port"
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
$taskSettings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $Name -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description "Omni Agent Gateway" -Force | Out-Null
Write-Output "Registered scheduled task $Name for Omni Agent Gateway."
