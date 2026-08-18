' Hidden LAN-accessible gateway launcher
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
Set env = ws.Environment("PROCESS")
env("HARNESS_GW_HOST") = "0.0.0.0"
ws.Run "cmd /c node gateway.js", 0, False
