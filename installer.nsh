!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\buttonpanel"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\buttonpanel"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\buttonpanel"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\buttonpanel"
!macroend

!macro customRemoveFiles
${if} ${isUpdated}
  !insertmacro quitSuccess
${else}
  RMDir /r $INSTDIR
${endIf}
!macroend

