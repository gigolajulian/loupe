; Uninstall (not an update): LOUPE takes out its Claude Code hooks, login item and ~/.loupe (main.js --uninstall)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall'
  ${endIf}
!macroend
