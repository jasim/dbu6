' ==============================================================================
' dbu6 Hidden Background Server Launcher
' Windows Zero-Flash VBScript Wrapper for dbu6 Accounting Server
' Launches the server completely hidden (No CMD, No PowerShell window, No Taskbar button)
' And opens http://localhost:2345 in the user's default web browser.
' ==============================================================================

Option Explicit
Dim fso, WshShell, scriptDir, projectDir, lockPath, isRunning, httpReq, i, ready, cmdStr, q, nodePath, logPath

Set fso = CreateObject("Scripting.FileSystemObject")
' scriptDir is the scripts folder
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
' projectDir is the parent folder (the dynamic root of dbu6)
projectDir = fso.GetParentFolderName(scriptDir)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = projectDir
q = Chr(34)

' 1. Check if dbu6 is ALREADY running on http://localhost:2345
isRunning = False
On Error Resume Next
Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
httpReq.setTimeouts 800, 800, 800, 1500
httpReq.Open "GET", "http://localhost:2345", False
httpReq.Send
If Err.Number = 0 Then
    isRunning = True
End If
On Error GoTo 0

If isRunning Then
    ' Server is already active; simply open default browser and exit
    WshShell.Run "http://localhost:2345", 1, False
    WScript.Quit 0
End If

' 2. Clean up stale lockfile if the process referenced in data\dbu6.lock is dead
lockPath = projectDir & "\data\dbu6.lock"
If fso.FileExists(lockPath) Then
    On Error Resume Next
    Dim ts, pidStr, procAlive, colProcs
    Set ts = fso.OpenTextFile(lockPath, 1)
    pidStr = Trim(ts.ReadAll)
    ts.Close
    procAlive = False
    If IsNumeric(pidStr) Then
        Set colProcs = GetObject("winmgmts:").ExecQuery("Select ProcessId from Win32_Process Where ProcessId = " & pidStr)
        If colProcs.Count > 0 Then
            procAlive = True
        End If
    End If
    If Not procAlive Then
        fso.DeleteFile lockPath, True
    End If
    On Error GoTo 0
End If

' 3. Ensure data directory exists for log
If Not fso.FolderExists(projectDir & "\data") Then
    On Error Resume Next
    fso.CreateFolder(projectDir & "\data")
    On Error GoTo 0
End If

' 4. Launch node hidden with stdout/stderr redirected to data\dbu6.log
' Window Style 0 = SW_HIDE (Completely Invisible), bWaitOnReturn = False
nodePath = projectDir & "\node_modules\@dbu6\app\bin\dbu6.mjs"
logPath = projectDir & "\data\dbu6.log"
cmdStr = "cmd.exe /c " & q & "node " & q & nodePath & q & " start > " & q & logPath & q & " 2>&1" & q
WshShell.Run cmdStr, 0, False

' 5. Wait for server to bind and respond on port 2345 (up to 15 seconds)
ready = False
For i = 1 To 50
    WScript.Sleep 200
    On Error Resume Next
    Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    httpReq.setTimeouts 200, 200, 200, 600
    httpReq.Open "GET", "http://localhost:2345", False
    httpReq.Send
    If Err.Number = 0 Then
        ready = True
        Exit For
    End If
    On Error GoTo 0
Next

' 6. Open default web browser at http://localhost:2345
WshShell.Run "http://localhost:2345", 1, False
WScript.Quit 0
