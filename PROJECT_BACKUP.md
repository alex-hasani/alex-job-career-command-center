# Project ZIP backups

Run `backup-project.ps1 -Source <project-directory> -Destination <backup-directory>` with PowerShell and Node.js 24 or later.

Store the working project outside a cloud-synchronized directory. The backup destination must be outside the project. Register the command with the chosen scheduler once daily at midnight.

The script includes hidden files, Git repositories, documents, existing backups, and empty directories. External symbolic links and junctions are recorded in `_project-backup-manifest.json`; their external targets are not traversed. Recreate these links on restore, or reinstall the dependencies. Live SQLite databases in `State` use verified online snapshots instead of copying active journals. Other files are captured over the backup interval, rather than as a filesystem-wide atomic snapshot.

ZIP creation and full read-back validation happen in the local temporary directory. A hash-verified copy is then published to the destination with a date, time, UTC offset, and unique suffix. Incomplete copies use `.partial`. Backups never overwrite existing archives.

After a new archive has been validated, hash-verified, and published, each backup cycle removes only completed `Job-Search_*.zip` archives whose timestamped filenames are older than seven days. Unrelated files, malformed archive names, and `.partial` files are not included in automatic retention. A retention deletion failure makes the cycle fail visibly after preserving the newly verified archive.

Full archives include private runtime data and must never be committed or published to the public repository.
