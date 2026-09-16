' Run the self-healing watchdog hidden (called by the scheduled task every 5 minutes).
' No Chinese text here on purpose: Windows Script Host reads .vbs in the ANSI codepage.
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run "cmd /c node watchdog.mjs", 0, False
