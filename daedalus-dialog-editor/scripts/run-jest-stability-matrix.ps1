param(
  [int]$Repeats = 2
)

$ErrorActionPreference = 'Stop'

function Get-UnsignedExitCode([int]$ExitCode) {
  return [BitConverter]::ToUInt32([BitConverter]::GetBytes($ExitCode), 0)
}

$matrix = @(
  @{ Name = 'default'; Command = 'npm test' },
  @{ Name = 'runInBand'; Command = 'npm test -- --runInBand' },
  @{ Name = 'stable'; Command = 'npm run test:stable:windows' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($entry in $matrix) {
  for ($attempt = 1; $attempt -le $Repeats; $attempt++) {
    Write-Host "`n>>> [$($entry.Name)] attempt $attempt/$Repeats"
    Write-Host "    $($entry.Command)"

    cmd /c $entry.Command
    $exitCode = $LASTEXITCODE
    $unsignedExitCode = Get-UnsignedExitCode -ExitCode $exitCode
    $isNativeCrash = ($unsignedExitCode -eq 3221226505)

    $results.Add([pscustomobject]@{
      Command      = $entry.Name
      Attempt      = $attempt
      ExitCode     = $exitCode
      ExitCodeHex  = ('0x{0:X8}' -f $unsignedExitCode)
      NativeCrash  = $isNativeCrash
    })

    if ($exitCode -ne 0) {
      Write-Warning "Command [$($entry.Name)] failed with exit code $exitCode (0x$('{0:X8}' -f $unsignedExitCode)) on attempt $attempt."
    }
  }
}

Write-Host "`nJest stability matrix summary:"
$results | Format-Table -AutoSize

$firstFailure = $results | Where-Object { $_.ExitCode -ne 0 } | Select-Object -First 1
if ($null -ne $firstFailure) {
  if ($firstFailure.NativeCrash) {
    Write-Error "Detected native Jest process exit (3221226505/0xC0000409) on '$($firstFailure.Command)' attempt $($firstFailure.Attempt)."
  } else {
    Write-Error "Detected failing matrix command '$($firstFailure.Command)' with exit code $($firstFailure.ExitCode) on attempt $($firstFailure.Attempt)."
  }
  exit 1
}

Write-Host "All matrix runs passed."
exit 0
