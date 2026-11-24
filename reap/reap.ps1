# reap: find processes Claude sessions left behind, and kill only the ones picked.
#   reap.ps1                 list leftovers (changes nothing)
#   reap.ps1 -Kill 123,456   kill those PIDs and their child trees (re-verified first). PID@start (start as
#                            yyyy-MM-ddTHH:mm:ss from -Json) also checks it is still the process that was listed.
#   reap.ps1 -All            kill every listed leftover
#   reap.ps1 -Json           {leftovers, sessions} as JSON for LOUPE; sessions = background tasks of live sessions
#                            (-Kill takes their PIDs too, -All never touches them)
#   reap.ps1 -SelfTest       spawn a dummy orphan, check it is found and killed
# Rules borrowed from zclean (MIT, TheStack-ai/zclean): orphan = parent gone; match on known
# dev-tool commands; allowlist; re-check PID + start time + command before killing; batch cap; kill log.
param([string[]]$Kill, [switch]$All, [switch]$SelfTest, [switch]$Json, [string]$Extra, [string]$AllowFile)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $env:USERPROFILE '.claude\reap.log'
$allowFile = if ($AllowFile) { $AllowFile } else { Join-Path $here 'allow.txt' }
$allow = @(Get-Content $allowFile -ErrorAction SilentlyContinue | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object { $_.Trim() })

# Processes Claude's Bash/PowerShell tools tend to leave running.
$names = '^(node|bash|sh|cmd|powershell|pwsh|python|pythonw|py|uv|esbuild|workerd|deno|bun|ffmpeg|chrome-headless-shell)\.exe$'
$cmds = @(
  'next\s+dev', '\bvite\b', 'wrangler', 'workerd', 'npx', 'npm(\.cmd)?\s+(run|exec|start)', 'astro\s+dev', 'remotion',
  'http\.server', 'uvicorn', 'playwright', 'mcp', 'esbuild', 'tsx\b', 'nodemon', '--watch', 'Documents\\Claude\\Projects', '[\\/]\.claude[\\/]'
)
if ($Extra) { $cmds += [regex]::Escape($Extra) }
$cmdRe = '(' + ($cmds -join '|') + ')'

function Get-Snapshot {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate, WorkingSetSize)
  $by = @{}; foreach ($p in $all) { $by[[int]$p.ProcessId] = $p }
  $kids = @{}; foreach ($p in $all) { $k = [int]$p.ParentProcessId; if (-not $kids[$k]) { $kids[$k] = @() }; $kids[$k] += $p }
  @{ all = $all; by = $by; kids = $kids }
}

function Get-Tree($snap, [int]$procId) {
  $out = @(); $stack = @($procId)
  while ($stack.Count) {
    $cur = $stack[0]; $stack = @($stack | Select-Object -Skip 1)
    foreach ($c in @($snap.kids[$cur])) { if ($c -and $c.ProcessId -ne $cur -and $c.CreationDate -ge $snap.by[$cur].CreationDate) { $out += $c; $stack += [int]$c.ProcessId } }
  }
  $out
}

function Find-Leftovers($snap) {
  $ports = Get-Ports
  foreach ($p in $snap.all) {
    if ($p.Name -notmatch $names -or -not $p.CommandLine -or $p.CommandLine -notmatch $cmdRe) { continue }
    $par = $snap.by[[int]$p.ParentProcessId]
    # Windows reuses PIDs: a "parent" that started after the child is a different process, so the real parent is gone.
    $orphan = (-not $par) -or ($par.CreationDate -gt $p.CreationDate)
    if (-not $orphan) { continue }
    New-Row $snap $p $ports
  }
}

function Get-Ports {
  $ports = @{}
  try { Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { $ports[[int]$_.OwningProcess] += @($_.LocalPort) } } catch {}
  $ports
}

function New-Row($snap, $p, $ports, $session) {
  $hit = $allow | Where-Object { $p.CommandLine -like "*$_*" } | Select-Object -First 1
  $tree = @(Get-Tree $snap ([int]$p.ProcessId))
  $all = @($p) + $tree
  $mem = ($all | Measure-Object WorkingSetSize -Sum).Sum
  $pp = @($all | ForEach-Object { $ports[[int]$_.ProcessId] } | Where-Object { $_ } | Sort-Object -Unique)
  [pscustomobject]@{
    Pid = [int]$p.ProcessId; Name = $p.Name; Started = $p.CreationDate; AgeH = [math]::Round(((Get-Date) - $p.CreationDate).TotalHours, 1)
    MemMB = [math]::Round($mem / 1MB); Ports = ($pp -join ','); Kids = $tree.Count; Allowed = [bool]$hit
    Cmd = ($p.CommandLine -replace '\s+', ' '); Label = (Get-Label $p.CommandLine); Stamp = $p.CreationDate; Host = $session
  }
}

# A short name for a command: what the Bash tool eval'd, else the command without its exe path.
function Get-Label([string]$cmd) {
  $c = $cmd -replace '\s+', ' '
  if ($c -match "eval '((?:[^']|'\\'')*)'") { $c = $Matches[1] -replace "'\\''", "'" }
  elseif ($c -match '^"[^"]+"\s*(.*)$' -or $c -match '^\S+\s*(.*)$') { $c = $Matches[1] }
  $c = $c -replace '^/d /s /c "?[^&]*chcp[^&]*&\s*', ''                               # PowerShell tool's cmd wrapper
  $c = $c -replace '"[^"]*[\\/]nodejs[\\/]npx"\s*', 'npx '
  $c = $c -replace '"(?:[A-Za-z]:|/)[^"]*[\\/]([^\\/"]+)"', '$1' -replace '(?:[A-Za-z]:)?[\\/][^\s"]*[\\/]([^\\/\s"]+)', '$1'  # paths -> file names
  $c = ($c -replace '(?i)\s*-(NoProfile|NonInteractive|NoLogo|WindowStyle \w+|ExecutionPolicy \w+|File)\b', '' -replace '"', '').Trim()
  if ($c -match 'CLAUDE_CODE_SHELL_LAUNCHER') { $c = 'PowerShell tool command' }  # the script itself sits in an env var
  if ($c.Length -gt 80) { $c.Substring(0, 80) } else { $c }
}

# Background tasks of live Claude Code sessions: children of a Claude Code claude.exe (not the desktop app's own
# Electron processes). Host = that claude.exe's PID, which LOUPE matches to a thread. MCP servers are skipped:
# they start with the session (first 90 s) or say mcp in their command.
function Find-SessionProcs($snap) {
  $ports = Get-Ports
  foreach ($s in $snap.all) {
    if ($s.Name -ne 'claude.exe' -or $s.CommandLine -match '--type=|\\WindowsApps\\') { continue }
    foreach ($c in @($snap.kids[[int]$s.ProcessId])) {
      if (-not $c -or $c.Name -eq 'conhost.exe' -or $c.CreationDate -lt $s.CreationDate) { continue }
      if (($c.CreationDate - $s.CreationDate).TotalSeconds -lt 90 -or $c.CommandLine -match '(?i)mcp') { continue }
      New-Row $snap $c $ports ([int]$s.ProcessId)
    }
  }
}

# Command lines can carry tokens and keys: reap.log gets them masked (PRIV-2).
function Hide-Secrets([string]$cmd) {
  $c = $cmd -replace '(?i)((?:--?|)[\w.-]*(?:token|key|secret|password|passwd|pwd|auth)[\w.-]*(?:=|:|\s+))("[^"]*"|\S+)', '$1***'
  $c -replace '(?i)(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA)[\w-]{8,}', '***'
}

function Stop-Leftover($snap, $row) {
  $now = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.Pid)"
  if (-not $now) { return "$($row.Pid) already gone" }
  if ($now.CreationDate -ne $row.Stamp -or ($now.CommandLine -replace '\s+', ' ') -ne $row.Cmd) { return "$($row.Pid) SKIPPED: PID now belongs to another process" }
  $tree = @(Get-Tree $snap $row.Pid)
  try { & taskkill.exe /PID $row.Pid /T /F 2>&1 | Out-Null } catch {}  # taskkill warns on stderr (a child already gone); 5.1 throws on that
  foreach ($t in $tree) { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue }  # children taskkill missed (already detached)
  $alive = Get-Process -Id $row.Pid -ErrorAction SilentlyContinue
  if ($alive -and $alive.WaitForExit(3000)) { $alive = $null }  # taskkill returns before the process has fully exited
  $line = '{0:s} {1} pid={2} kids={3} mem={4}MB {5}' -f (Get-Date), ($(if ($alive) { 'kill-failed' } else { 'killed' })), $row.Pid, $tree.Count, $row.MemMB, (Hide-Secrets $row.Cmd)
  Add-Content -Path $log -Value $line -Encoding utf8
  if ($alive) { "$($row.Pid) FAILED to stop" } else { "$($row.Pid) killed ($($tree.Count) children, $($row.MemMB) MB)" }
}

if ($SelfTest) {
  $tag = "reap-selftest-$PID"
  # cmd starts a sleeper and exits at once, so the sleeper's parent is gone: a real orphan.
  Start-Process cmd.exe -ArgumentList "/c start /b powershell.exe -NoProfile -Command `"Start-Sleep 120 # $tag Documents\Claude\Projects --api-token=$tag-secret`"" -WindowStyle Hidden
  Start-Sleep 3
  $snap = Get-Snapshot
  $row = @(Find-Leftovers $snap) | Where-Object { $_.Cmd -like "*$tag*" }
  if (-not $row) { throw 'self-test: orphan not detected' }
  $r = Stop-Leftover $snap $row[0]
  Start-Sleep 1
  if (Get-Process -Id $row[0].Pid -ErrorAction SilentlyContinue) { throw "self-test: kill failed ($r)" }
  'self-test ok: found and killed the dummy orphan'
  return
}

$snap = Get-Snapshot
$rows = @(Find-Leftovers $snap | Sort-Object Started)
if ($Kill -or $All) {
  # one "-Kill 1,2" argument through -File arrives as a single string: split it here, never parse it as a number
  $want = @{}
  foreach ($k in @($Kill -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    $id, $at = $k -split '@', 2; $n = 0
    if ([int]::TryParse($id, [ref]$n)) { $want[$n] = $at }
  }
  $Kill = @($want.Keys)
  $live = @(Find-SessionProcs $snap)
  $pick = if ($All) { @($rows | Where-Object { -not $_.Allowed }) } else { @(@($rows) + $live | Where-Object { $Kill -contains $_.Pid -and (-not $want[$_.Pid] -or $want[$_.Pid] -eq $_.Started.ToString('s')) }) }
  $missing = @($Kill | Where-Object { @(@($rows) + $live).Pid -notcontains $_ })
  $stale = @(@($rows) + $live | Where-Object { $want[$_.Pid] -and $want[$_.Pid] -ne $_.Started.ToString('s') })
  $res = @(foreach ($m in $missing) { "$m SKIPPED: not a leftover or session background task" }) +
    @(foreach ($x in $stale) { "$($x.Pid) SKIPPED: PID now belongs to another process" }) +
    @($pick | Select-Object -First 20 | ForEach-Object { Stop-Leftover $snap $_ })  # batch cap, as in zclean
  if ($pick.Count -gt 20) { $res += "$($pick.Count - 20) more left, run again" }
  if ($Json) { ConvertTo-Json -InputObject $res -Compress } else { $res }
  return
}
if ($Json) {
  $cols = 'Pid', 'Name', @{n='Started';e={$_.Started.ToString('s')}}, 'AgeH', 'MemMB', 'Ports', 'Kids', 'Allowed', 'Cmd', 'Label', 'Host'
  ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{
    leftovers = @($rows | Select-Object $cols); sessions = @(Find-SessionProcs $snap | Select-Object $cols) })
  return
}
if (-not $rows) { 'No leftovers.'; return }
$rows | ForEach-Object {
  '{0,6}  {1,-11} {2:MM-dd HH:mm}  {3,5}h  {4,5}MB  port {5,-6} {6}{7}' -f $_.Pid, $_.Name, $_.Started, $_.AgeH, $_.MemMB, $(if ($_.Ports) { $_.Ports } else { '-' }), $(if ($_.Allowed) { '[keep] ' } else { '' }), ($_.Cmd.Substring(0, [Math]::Min(120, $_.Cmd.Length)))
}
