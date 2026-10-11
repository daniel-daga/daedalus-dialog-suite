$ErrorActionPreference = 'Stop'
$env:CI = 'true'

$maxNativeCrashRetries = 1

function Get-UnsignedExitCode([int]$ExitCode) {
  return [BitConverter]::ToUInt32([BitConverter]::GetBytes($ExitCode), 0)
}

Write-Host 'Collecting Jest test suite list...'
$testSuites = (& npx jest --listTests | Sort-Object)
if ($LASTEXITCODE -ne 0) {
  throw "Failed to list Jest test suites (exit code $LASTEXITCODE)."
}

if (-not $testSuites -or $testSuites.Count -eq 0) {
  throw 'No Jest suites found.'
}

Write-Host "Running $($testSuites.Count) suites in isolated processes for Windows stability..."

$results = New-Object System.Collections.Generic.List[object]
$failedSuite = $null

foreach ($suite in $testSuites) {
  $attempt = 0
  $suitePassed = $false

  while (-not $suitePassed) {
    $attempt += 1
    Write-Host "`n>>> $suite (attempt $attempt)"

    & npx jest --runInBand --watchAll=false --no-cache --runTestsByPath $suite

    $exitCode = $LASTEXITCODE
    $unsignedExitCode = Get-UnsignedExitCode -ExitCode $exitCode
    $isNativeCrash = ($unsignedExitCode -eq 3221226505)

    $results.Add([pscustomobject]@{
      Suite       = $suite
      Attempt     = $attempt
      ExitCode    = $exitCode
      ExitCodeHex = ('0x{0:X8}' -f $unsignedExitCode)
      NativeCrash = $isNativeCrash
    })

    if ($exitCode -eq 0) {
      $suitePassed = $true
      continue
    }

    if ($isNativeCrash -and $attempt -le ($maxNativeCrashRetries + 1)) {
      if ($attempt -le $maxNativeCrashRetries) {
        Write-Warning "Native crash while running '$suite'. Retrying once..."
        continue
      }
    }

    $failedSuite = [pscustomobject]@{
      Suite       = $suite
      Attempt     = $attempt
      ExitCode    = $exitCode
      ExitCodeHex = ('0x{0:X8}' -f $unsignedExitCode)
      NativeCrash = $isNativeCrash
    }
    break
  }

  if ($null -ne $failedSuite) {
    break
  }
}

if ($null -ne $failedSuite) {
  if ($failedSuite.NativeCrash) {
    throw "Detected native Jest crash while running suite '$($failedSuite.Suite)' (3221226505 / 0xC0000409) on attempt $($failedSuite.Attempt)."
  }
  throw "Detected failing suite '$($failedSuite.Suite)' with exit code $($failedSuite.ExitCode) on attempt $($failedSuite.Attempt)."
}

Write-Host '`nAll suites passed in isolated-process mode.'
exit 0
