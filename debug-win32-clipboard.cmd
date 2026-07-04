@echo off
REM === AURIX AGENT — Windows Clipboard Debug ===
REM Run from aurix-agent root directory: debug-win32-clipboard.cmd
REM This script simulates and diagnoses all clipboard issues on Windows.

echo ============================================================
echo   AURIX Agent — Windows Clipboard Diagnostic
echo ============================================================
echo.

echo [1/6] Checking OS and shell...
echo   Platform: %OS%
echo   ComSpec:  %COMSPEC%
echo   ConPTY:   (check if TERM is set)
if defined TERM (echo   TERM: %TERM% - Windows Terminal detected) else (echo   TERM: not set - likely legacy cmd.exe or Windows Console Host)
echo.

echo [2/6] Testing "clip.exe" (built-in Windows clipboard for copy)...
echo hello from clip.exe | clip
if %ERRORLEVEL% EQU 0 (
    echo   [OK] clip.exe works for copy
) else (
    echo   [FAIL] clip.exe failed — copy broken
)
echo.

echo [3/6] Testing PowerShell Get-Clipboard (for paste)...
powershell -NoProfile -Command "if (Get-Command Get-Clipboard -ErrorAction SilentlyContinue) { Write-Host '  [OK] Get-Clipboard available' } else { Write-Host '  [FAIL] Get-Clipboard not found — .NET clipboard may need STA thread' }"
echo.

echo [4/6] Testing PowerShell Add-Type clipboard (alternative for paste)...
powershell -NoProfile -Command "$text = Get-Clipboard -ErrorAction SilentlyContinue; if ($?) { Write-Host '  [OK] clipboard read returned:' $text } else { Write-Host '  [INFO] Get-Clipboard failed. Try STA thread: powershell -STA -Command ...' }"
echo.

echo [5/6] Testing OSC 52 terminal protocol (escape sequence based copy)...
echo   This test requires a terminal that supports OSC 52:
echo   - Windows Terminal (WT.exe): YES (since v1.18)
echo   - ConEmu: YES
echo   - cmd.exe (Windows Console Host): NO
echo   - PowerShell ISE: NO
echo.
echo   Checking terminal type...
set "WT_SESSION=0"
if defined WT_SESSION set "WT_SESSION=1"
if "%WT_SESSION%"=="1" (echo   [OK] Windows Terminal detected - OSC 52 supported) else (echo   [INFO] Not Windows Terminal - OSC 52 may not work)

echo.

echo [6/6] Testing Ctrl+V paste behavior...
echo   In aurix LiteApp:
echo     - Ctrl+V is handled by keypress listener (must NOT skip ctrl)
echo     - SetupUI (modal input boxes): Ctrl+V via readClipboard (InputBox.js)
echo     - slashedInput (main prompt): Ctrl+V handler added in latest fix
echo.
echo   BUG ROOT CAUSE:
echo     1. copyToClipboard only tried Linux tools (wl-copy, xclip, xsel)
echo        and macOS pbcopy. clip.exe was missing for Windows.
echo     2. OSC 52 fallback works but only on Windows Terminal v1.18+.
echo        Older cmd.exe and Console Host do NOT support it.
echo     3. slashedInput had NO Ctrl+V handler at all — the keypress
echo        listener skipped all ctrl keys (line 285 before fix).
echo     4. readClipboard() function didn't exist — only SetupUI had
echo        clipboard read support via InputBox.js.
echo.
echo   FIXES APPLIED:
echo     - copyToClipboard(): Added clip.exe branch for platform==='win32'
echo     - readClipboard(): New function with powershell Get-Clipboard
echo     - slashedInput(): Ctrl+V handler calls readClipboard + pastes
echo     - Auto-copy via OSC 52 still works on supported terminals
echo.

echo ============================================================
echo   Manual test steps:
echo     1. Open Windows Terminal
echo     2. cd to aurix-agent directory
echo     3. Run: node dist/index.js
echo     4. Type /copy 1 (should copy last assistant message)
echo     5. Press Ctrl+V (should paste clipboard content)
echo     6. Select text with mouse (should auto-copy via OSC 52
echo        if using Windows Terminal)
echo ============================================================
echo.

echo Diagnostic complete. Check output above for [FAIL] markers.
pause
