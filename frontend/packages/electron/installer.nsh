!macro customInit
  # Some local/custom builds accidentally bundled Android Gradle intermediates
  # below app.asar.unpacked. Their paths can exceed the legacy NSIS MAX_PATH
  # limit, causing the old uninstaller to return error code 2 before an update.
  # Remove only that known, unused build directory using the Win32 long-path
  # prefix before electron-builder invokes the old uninstaller.
  StrCpy $R8 "$INSTDIR\resources\app.asar.unpacked\node_modules\@capacitor\android\capacitor\build"
  ${If} ${FileExists} "$R8\*.*"
    DetailPrint "Removing legacy Android build files from the Windows installation..."
    nsExec::ExecToLog '"$SYSDIR\cmd.exe" /D /C RD /S /Q "\\?\$R8"'
    Pop $R9
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\RegisteredApplications" "MailFlow" "Software\Clients\Mail\MailFlow\Capabilities"

  WriteRegStr SHCTX "Software\Clients\Mail\MailFlow" "" "MailFlow"
  WriteRegStr SHCTX "Software\Clients\Mail\MailFlow\Capabilities" "ApplicationName" "MailFlow"
  WriteRegStr SHCTX "Software\Clients\Mail\MailFlow\Capabilities" "ApplicationDescription" "A self-hosted, unified webmail client."
  WriteRegStr SHCTX "Software\Clients\Mail\MailFlow\Capabilities\URLAssociations" "mailto" "MailFlow.mailto"

  WriteRegStr SHCTX "Software\Classes\MailFlow.mailto" "" "URL:MailFlow MailTo Protocol"
  WriteRegStr SHCTX "Software\Classes\MailFlow.mailto" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\MailFlow.mailto\DefaultIcon" "" "$INSTDIR\MailFlow.exe,0"
  WriteRegStr SHCTX "Software\Classes\MailFlow.mailto\shell\open\command" "" '"$INSTDIR\MailFlow.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\RegisteredApplications" "MailFlow"
  DeleteRegKey SHCTX "Software\Clients\Mail\MailFlow"
  DeleteRegKey SHCTX "Software\Classes\MailFlow.mailto"
!macroend
