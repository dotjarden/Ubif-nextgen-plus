# Daily auto-update on Windows (ZIP installation)

This guide sets up a Windows scheduled task that downloads the latest copy of this repository every day at 10:00 AM and extracts it over your existing installation. It needs no Git or Node.js, only the PowerShell that ships with Windows.

It uses [`scripts/update-ubif-extension.ps1`](../scripts/update-ubif-extension.ps1), which:

1. Downloads the `main` branch ZIP into your **Documents** folder.
2. Extracts it there, creating or overwriting `Documents\Ubif-nextgen-plus-main`.
3. Deletes the ZIP and writes the result to `Documents\ubif-update-log.txt`.

Chrome still has to reload the extension after the files change. See [step 5](#5-after-an-update).

## Setup

### 1. Save the script

Download [`update-ubif-extension.ps1`](https://raw.githubusercontent.com/dotjarden/Ubif-nextgen-plus/main/scripts/update-ubif-extension.ps1) (right-click, **Save link as**) into your **Documents** folder.

### 2. Run it once

Open **Command Prompt** and paste:

```
powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\Documents\update-ubif-extension.ps1"
```

A folder named `Ubif-nextgen-plus-main` appears in Documents, and `ubif-update-log.txt` should say `Update OK` with the version number.

### 3. Load it in Chrome

Skip this if Chrome already loads the extension from this folder.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked**.
3. Select `Documents\Ubif-nextgen-plus-main\extension` (the **extension** folder inside, not the main folder).
4. Refresh your portal tabs.

### 4. Schedule the daily update

In Command Prompt, paste:

```
schtasks /Create /TN "Update Ubif NextGen Plus" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%USERPROFILE%\Documents\update-ubif-extension.ps1\"" /SC DAILY /ST 10:00 /F
```

To test the task right away:

```
schtasks /Run /TN "Update Ubif NextGen Plus"
```

### 5. After an update

Chrome does not reload unpacked extensions on its own. Open `chrome://extensions`, click the reload icon on **UBIF NextGen Plus**, then refresh your portal tabs. Restarting Chrome also works. Finish any unsaved portal work first.

## Troubleshooting

| Symptom | Try this |
| --- | --- |
| "The argument ... does not exist" or "cannot find the file" | The script is not where the command looks. Confirm it is in Documents and is not named `update-ubif-extension.ps1.txt`. If Documents is synced to OneDrive, replace `%USERPROFILE%\Documents` in both commands with the real path, for example `C:\Users\<name>\OneDrive\Documents`. In File Explorer, Shift + right-click the script and choose **Copy as path** to get it. |
| Log says `Update FAILED` | The download was blocked or the network was down. Read the message on that line of `ubif-update-log.txt`. |
| "Running scripts is disabled" or blocked by policy | PowerShell is restricted by group policy on that PC. Ask IT, or update manually using the ZIP steps in the README. |
| The task did not run | It only runs while the PC is on and you are signed in at 10:00 AM. In Task Scheduler, open the task and enable **Run task as soon as possible after a scheduled start is missed**. |
| Files updated but nothing changed in the portal | Reload the extension and refresh the portal. On `chrome://extensions`, open **Details** and confirm the source path is `Documents\Ubif-nextgen-plus-main\extension`. |

## Notes

- Do not move or rename `Ubif-nextgen-plus-main`. Chrome reads the extension from there, and your settings stay tied to that installation.
- The script adds and overwrites files. It does not delete files that were removed from the repository.
- The task installs whatever is on `main` each day without review. Use it only where that is acceptable.
- To remove the task: `schtasks /Delete /TN "Update Ubif NextGen Plus" /F`
