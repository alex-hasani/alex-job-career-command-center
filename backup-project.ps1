param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\')
$destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
$sqliteSnapshotTool = Join-Path $PSScriptRoot 'snapshot-sqlite.mjs'
if ($sourceRoot -eq [IO.Path]::GetPathRoot($sourceRoot).TrimEnd('\')) { throw 'A drive root cannot be backed up with this project tool.' }
if ($destinationRoot -eq $sourceRoot -or $destinationRoot.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The backup destination must be outside the project.' }
if (-not (Test-Path -LiteralPath $sqliteSnapshotTool)) { throw "SQLite snapshot tool is missing: $sqliteSnapshotTool" }

# One backup at a time, including across scheduler retries.
$mutex = New-Object Threading.Mutex($false, 'Local\CareerCommandCenterProjectZip')
if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); throw 'A project backup is already running.' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('career-project-backup-' + [guid]::NewGuid().ToString('N'))
$publishedPartial = $null
try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  $started = [DateTimeOffset]::Now
  $name = 'Job-Search_' + $started.ToString('yyyy-MM-dd_HH-mm-ss_zzz').Replace(':','') + '_' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.zip'
  $archivePath = Join-Path $stage $name
  $files = New-Object 'System.Collections.Generic.List[object]'
  $directories = New-Object 'System.Collections.Generic.List[string]'
  $links = New-Object 'System.Collections.Generic.List[object]'
  function Read-ProjectDirectory([string]$directory) {
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
      $relative = $item.FullName.Substring($sourceRoot.Length + 1)
      if ($item.LinkType) {
        $links.Add([ordered]@{ path=$relative; type=$item.LinkType; target=@($item.Target) })
      } elseif ($item.PSIsContainer) {
        $directories.Add($relative)
        Read-ProjectDirectory $item.FullName
      } else { $files.Add($item) }
    }
  }
  Read-ProjectDirectory $sourceRoot

  # SQLite's online backup API produces a standalone consistent database while
  # the app continues running. Never archive a live database by raw file copy.
  $sqliteSnapshots = @{}
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($sourceRoot.Length + 1)
    if ($relative -match '^State\\.*\.(sqlite|sqlite3|db)$') {
      $snapshot = Join-Path $stage ([guid]::NewGuid().ToString('N') + '.sqlite')
      & node $sqliteSnapshotTool $file.FullName $snapshot
      if ($LASTEXITCODE -ne 0) { throw "SQLite snapshot failed: $relative" }
      $sqliteSnapshots[$file.FullName] = $snapshot
    }
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
  $entryCount = 0
  try {
    foreach ($directory in $directories) { $null = $zip.CreateEntry($directory.Replace('\','/') + '/'); $entryCount++ }
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($sourceRoot.Length + 1)
      # Journals are represented by the consistent SQLite snapshot above.
      if ($relative -match '^State\\.*\.(sqlite|sqlite3|db)-(wal|shm|journal)$') { continue }
      $inputPath = $file.FullName
      if ($sqliteSnapshots.ContainsKey($inputPath)) { $inputPath = $sqliteSnapshots[$inputPath] }
      $inputStream = [IO.File]::Open($inputPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try {
        $entry = $zip.CreateEntry($relative.Replace('\','/'), [IO.Compression.CompressionLevel]::Fastest)
        if ($file.LastWriteTime.Year -ge 1980 -and $file.LastWriteTime.Year -le 2107) { $entry.LastWriteTime = $file.LastWriteTime }
        $outputStream = $entry.Open()
        try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
        $entryCount++
      } finally { $inputStream.Dispose() }
    }
    $entry = $zip.CreateEntry('_project-backup-manifest.json')
    $writer = New-Object IO.StreamWriter($entry.Open())
    try {
      $writer.Write(([ordered]@{
        startedAt=$started.ToString('o'); source=$sourceRoot; files=$files.Count
        sqliteSnapshots=@($sqliteSnapshots.Keys | ForEach-Object { $_.Substring($sourceRoot.Length + 1) })
        links=@($links.ToArray())
        restore='Extract into an empty local project directory. Recreate the listed external dependency links or install dependencies. SQLite journals are intentionally replaced by standalone online snapshots. Other files are captured during the stated backup interval.'
      } | ConvertTo-Json -Depth 6))
    } finally { $writer.Dispose() }
    $entryCount++
  } finally { $zip.Dispose() }

  # Read every archived entry before publishing a completed ZIP to the sync folder.
  $check = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    if ($check.Entries.Count -ne $entryCount) { throw 'ZIP entry count mismatch.' }
    foreach ($entry in $check.Entries) {
      $stream = $entry.Open()
      try { $stream.CopyTo([IO.Stream]::Null) } finally { $stream.Dispose() }
    }
  } finally { $check.Dispose() }
  New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
  $publishedPartial = Join-Path $destinationRoot ($name + '.partial')
  Copy-Item -LiteralPath $archivePath -Destination $publishedPartial
  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $publishedPartial -Algorithm SHA256).Hash -ne $hash) { throw 'Published ZIP hash mismatch.' }
  $published = Join-Path $destinationRoot $name
  Move-Item -LiteralPath $publishedPartial -Destination $published
  $publishedPartial = $null
  [ordered]@{ok=$true; archive=$published; bytes=(Get-Item -LiteralPath $published).Length; entries=$entryCount; sha256=$hash; completedAt=[DateTimeOffset]::Now.ToString('o')} | ConvertTo-Json
} finally {
  if ($publishedPartial -and (Test-Path -LiteralPath $publishedPartial)) { Remove-Item -LiteralPath $publishedPartial }
  # Only this invocation's validated, newly created temporary directory is removed.
  if ((Split-Path -Parent $stage) -eq ([IO.Path]::GetTempPath()).TrimEnd('\') -and (Split-Path -Leaf $stage) -like 'career-project-backup-*') {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
