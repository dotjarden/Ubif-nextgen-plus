# Daily auto-update on Windows (ZIP installation)

This guide sets up a Windows scheduled task that downloads the latest copy of this repository every day at 10:00 AM and copies it over your existing installation. It needs no Git or Node.js, only the PowerShell that ships with Windows.

The updater, [`scripts/update-ubif-extension.ps1`](../scripts/update-ubif-extension.ps1), already comes with every download of this repository. It updates the installation it lives in:

1. It finds the installation folder one level above `scripts` (for example `Documents\Ubif-nextgen-plus-main`).
2. It downloads the `main` branch ZIP to a temporary folder and extracts it there.
3. It copies new and changed files over the installation, deletes the temporary files, and writes the result to `ubif-update-log.txt` in the installation folder.

It refuses to run if it is not inside an installation's `scripts` folder, or if the installation is a Git checkout (use `npm run update` for those).

Chrome still has to reload the extension after the files change. See [step 4](#4-after-an-update).

## Setup

The commands below assume the installation is `Documents\Ubif-nextgen-plus-main`. If yours is somewhere else, change the path in each command to match.

### 1. Install the extension

Skip this if Chrome already loads the extension from a ZIP installation.

1. Download the repository using **Code → Download ZIP** and extract it into your **Documents** folder, so you have `Documents\Ubif-nextgen-plus-main`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select `Documents\Ubif-nextgen-plus-main\extension` (the **extension** folder inside, not the main folder).
4. Refresh your portal tabs.

### 2. Schedule the daily update

Open **Command Prompt** and paste:

```
schtasks /Create /TN "Update Ubif NextGen Plus" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%USERPROFILE%\Documents\Ubif-nextgen-plus-main\scripts\update-ubif-extension.ps1\"" /SC DAILY /ST 10:00 /F
```

### 3. Test it

Run the task once right away:

```
schtasks /Run /TN "Update Ubif NextGen Plus"
```

After a few seconds, open `ubif-update-log.txt` in the installation folder. It should say `Update OK` with the version number.

### 4. After an update

Chrome does not reload unpacked extensions on its own. Open `chrome://extensions`, click the reload icon on **UBIF NextGen Plus**, then refresh your portal tabs. Restarting Chrome also works. Finish any unsaved portal work first.

## Switching from the earlier setup

An earlier version of this guide had you save the script directly in **Documents**. To switch:

1. Run the step 2 command again. `/F` replaces the old task so it points at the script inside the installation.
2. Delete `update-ubif-extension.ps1` and `ubif-update-log.txt` from Documents. The log now lives in the installation folder.

## Troubleshooting

| Symptom | Try this |
| --- | --- |
| "The argument ... does not exist" or "cannot find the file" | The path in the command does not match your installation. In File Explorer, open the installation's `scripts` folder, Shift + right-click `update-ubif-extension.ps1`, choose **Copy as path**, and paste that into the command in place of the quoted path. If Documents is synced to OneDrive, the path will look like `C:\Users\<name>\OneDrive\Documents\...`. |
| No log file appears | The script stopped before it found the installation. Run it by hand to see the error: `powershell -ExecutionPolicy Bypass -File "<path to update-ubif-extension.ps1>"` |
| Log says `No extension\manifest.json found` | The script is not inside an installation's `scripts` folder. Point the task at the copy inside the installation. |
| Log says `is a Git checkout` | This installation uses Git. Update it with `npm run update` or `git pull --ff-only` instead. |
| Log says `Update FAILED` with a download error | The download was blocked or the network was down. Try again later or check with IT. |
| "Running scripts is disabled" or blocked by policy | PowerShell is restricted by group policy on that PC. Ask IT, or update manually using the ZIP steps in the README. |
| The task did not run | It only runs while the PC is on and you are signed in at 10:00 AM. In Task Scheduler, open the task and enable **Run task as soon as possible after a scheduled start is missed**. |
| Files updated but nothing changed in the portal | Reload the extension and refresh the portal. On `chrome://extensions`, open **Details** and confirm the source path is the `extension` folder of the installation the task updates. |

## Notes

- Do not move or rename the installation folder after loading it. Chrome reads the extension from there, and your settings stay tied to that installation. If you do move it, run the step 2 command again with the new path.
- The updater adds and overwrites files. It does not delete files that were removed from the repository.
- The task installs whatever is on `main` each day without review. Use it only where that is acceptable.
- To remove the task: `schtasks /Delete /TN "Update Ubif NextGen Plus" /F`
