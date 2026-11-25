; Uninstall cleanup (EXIT-2). Skipped when an update runs the old uninstaller.
; LOUPE.exe --uninstall takes LOUPE's own hooks out of ~/.claude/settings.json (backup first) and removes ~/.loupe
; (uninstall.js); the Run value is the login item; nsis.deleteAppDataOnUninstall removes %APPDATA%\LOUPE.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\LOUPE.exe" --uninstall'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.juliangigola.loupe"
  ${endIf}
!macroend
