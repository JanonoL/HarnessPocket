' 隐藏启动网关（用于开机自启，不弹出黑窗口）
' 自动以本脚本所在目录为工作目录，无硬编码路径。
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run "cmd /c node gateway.js", 0, False
