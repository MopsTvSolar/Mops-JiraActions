Option Explicit

Dim objShell, objFSO
Dim scriptPath, projectDir, edgePath, chromePath, url, i

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

scriptPath = WScript.ScriptFullName
projectDir = objFSO.GetParentFolderName(scriptPath)
url = "http://127.0.0.1:5000/"

' Mata qualquer processo ouvindo na porta 5000
objShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do taskkill /F /PID %a", 0, True

WScript.Sleep 1500

' Inicia o servidor novo
objShell.Run "cmd /c cd /d """ & projectDir & """ && python api\index.py", 0, False

' Aguarda subir
Dim http, serverRunning
serverRunning = False
For i = 1 To 40
    WScript.Sleep 500
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", url, False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
        serverRunning = True
        Err.Clear
        On Error GoTo 0
        Exit For
    End If
    Err.Clear
    On Error GoTo 0
Next

If Not serverRunning Then
    MsgBox "Servidor nao subiu. Verifique o Python.", vbExclamation, "Reiniciar App"
    WScript.Quit 1
End If

edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

If objFSO.FileExists(edgePath) Then
    objShell.Run """" & edgePath & """ --app=" & url & " --window-size=1440,900", 1, False
ElseIf objFSO.FileExists(chromePath) Then
    objShell.Run """" & chromePath & """ --app=" & url & " --window-size=1440,900", 1, False
Else
    objShell.Run url, 1, False
End If
