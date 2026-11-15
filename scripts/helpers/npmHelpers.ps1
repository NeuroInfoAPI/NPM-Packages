# npm requires 2FA for deprecate (granular tokens can no longer bypass it). Publishing runs
# via GitHub Actions (.github/workflows/publish.yml) with Trusted Publishing instead.
# Authentication uses an interactive `npm login` (web/2FA) into a temporary npmrc;
# the session token is revoked via `npm logout` and the file deleted afterwards.
$script:NpmRegistry = 'https://registry.npmjs.org/'
function Invoke-Npm {
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $output = & npm.cmd @Arguments 2>&1
    return [PSCustomObject]@{ Output = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim(); ExitCode = $LASTEXITCODE }
}
function Invoke-NpmChecked {
    param([string[]]$Arguments)
    $result = Invoke-Npm -Arguments $Arguments
    if ($result.ExitCode -ne 0) { throw "npm $($Arguments[0]) failed: $($result.Output)" }
    return $result.Output
}
function ConvertTo-ProcessArgument {
    param([string]$Value)
    if ($Value -and $Value -notmatch '[\s"]') { return $Value }
    return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
function Get-NpmCommandLine {
    param([string[]]$Arguments)
    $npmCli = Join-Path (Split-Path -Parent (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
    if (!(Test-Path -LiteralPath $npmCli)) { throw "npm CLI not found at $npmCli." }
    return [PSCustomObject]@{
        Node = (Get-Command node.exe).Source
        Arguments = (@($npmCli) + $Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' '
    }
}
# Runs npm attached to the console (used for login, which shows its own browser link).
# Uses node + npm-cli.js directly to avoid cmd.exe re-parsing arguments.
function Invoke-NpmInteractive {
    param([string[]]$Arguments)
    $command = Get-NpmCommandLine $Arguments
    $process = Start-Process -FilePath $command.Node -ArgumentList $command.Arguments -NoNewWindow -Wait -PassThru
    return $process.ExitCode
}
function Start-NpmAuthentication {
    $state = [PSCustomObject]@{
        UserConfig = $env:NPM_CONFIG_USERCONFIG
        ConfigPath = Join-Path $env:TEMP ('npmrc-release-' + [Guid]::NewGuid().ToString() + '.npmrc')
        LoggedIn = $false
    }
    try {
        Set-Content -LiteralPath $state.ConfigPath -Encoding ASCII -Value "registry=$script:NpmRegistry"
        $env:NPM_CONFIG_USERCONFIG = $state.ConfigPath
        Write-Host 'Logging in to npm. Press ENTER to open the link, then sign in and confirm with your passkey in the browser.' -ForegroundColor Cyan
        $exitCode = Invoke-NpmInteractive -Arguments @('login', '--auth-type=web', "--registry=$script:NpmRegistry")
        if ($exitCode -ne 0) { throw "npm login failed (exit code $exitCode)." }
        $state.LoggedIn = $true
        $user = Invoke-NpmChecked -Arguments @('whoami', "--registry=$script:NpmRegistry")
        Write-Host "Logged in as $user. npm asks for passkey confirmation in the browser again for the deprecation." -ForegroundColor Green
        return $state
    } catch { Stop-NpmAuthentication -State $state; throw }
}
function Stop-NpmAuthentication {
    param($State)
    if ($null -eq $State) { return }
    if ($State.LoggedIn) {
        # Revokes the session token on the registry.
        $logout = Invoke-Npm -Arguments @('logout', "--registry=$script:NpmRegistry")
        if ($logout.ExitCode -ne 0) { Write-Host "npm logout failed; revoke the session manually under npmjs.com > Access Tokens. $($logout.Output)" -ForegroundColor Yellow }
        $State.LoggedIn = $false
    }
    $env:NPM_CONFIG_USERCONFIG = $State.UserConfig
    if (Test-Path -LiteralPath $State.ConfigPath) { Remove-Item -LiteralPath $State.ConfigPath -Force }
}
