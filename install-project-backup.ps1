param(
  [Parameter(Mandatory=$true)][string]$Destination,
  [string]$TaskName='Alex Job - 3 Hour Project Backup'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupScript = Join-Path $PSScriptRoot 'backup-project.ps1'
if (-not (Test-Path -LiteralPath $backupScript)) { throw "Backup script is missing: $backupScript" }
if (-not (Test-Path -LiteralPath $projectRoot)) { throw "Project directory is missing: $projectRoot" }
$destinationRoot = [IO.Path]::GetFullPath($Destination)
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Source "{1}" -Destination "{2}"' -f $backupScript,$projectRoot,$destinationRoot
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 3) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Creates a verified, dated ZIP of the complete Job Search project every three hours.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
