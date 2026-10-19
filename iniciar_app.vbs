Option Explicit

' Atalho desktop do Extrator de Chamados Jira: sobe o servidor local
' (python api/index.py) se ele ainda não estiver no ar, espera responder e
' abre numa janela "de app" (Edge/Chrome --app=, sem barra de endereço/abas)
' em vez de uma aba normal de navegador. Roda 100% invisível (via wscript),
' sem janela de console piscando na tela.

Dim objShell, objFSO
Dim scriptPath, projectDir, edgePath, chromePath, url, serverRunning, i

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

scriptPath = WScript.ScriptFullName
projectDir = objFSO.GetParentFolderName(scriptPath)
url = "http://127.0.0.1:5000/"

serverRunning = CheckServer(url)

If Not serverRunning Then
    objShell.Run "cmd /c cd /d """ & projectDir & """ && python api\index.py", 0, False

    For i = 1 To 40 ' até 20s esperando o servidor subir
        WScript.Sleep 500
        If CheckServer(url) Then
            serverRunning = True
            Exit For
        End If
    Next
End If

If Not serverRunning Then
    MsgBox "Não consegui iniciar o servidor local (python api\index.py). Confira se o Python está instalado e no PATH.", vbExclamation, "Extrator de Chamados Jira"
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

' Faz um GET simples e devolve True só se respondeu 200 — usado tanto pra
' checar se o servidor já estava de pé quanto pra esperar ele terminar de
' subir depois de iniciado.
Function CheckServer(u)
    Dim http
    CheckServer = False
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", u, False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
        CheckServer = True
    End If
    Err.Clear
    On Error Goto 0
End Function
