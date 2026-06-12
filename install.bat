@echo off
setlocal enabledelayedexpansion
title AURIX Agent - Installer

echo.
echo   AURIX Agent - Installer (Windows)
echo.

set "INSTALL_DIR=%USERPROFILE%\.aurix\agent"
set "REPO=https://github.com/DekaPrayoga/AurixAgent.git"

:: 1. Check Node.js
echo ==^> Checking Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   Node.js not found.
    echo   Please install Node.js 20+ from https://nodejs.org/
    echo   Or run: winget install OpenJS.NodeJS.LTS
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v ok

:: 2. Check Bun
echo ==^> Checking Bun runtime...
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo   Bun not found. Installing...
    powershell -Command "irm bun.sh/install.ps1 | iex"
    if %errorlevel% neq 0 (
        echo   Bun install failed. Trying npm...
        npm install -g bun
        if %errorlevel% neq 0 (
            echo   ERROR: Could not install Bun. Install manually from https://bun.sh
            pause
            exit /b 1
        )
    )
)
for /f "tokens=*" %%v in ('bun --version 2^>nul') do echo   Bun %%v ok

:: 3. Check Rust (optional, for native token counter)
echo ==^> Checking Rust toolchain (optional)...
where rustc >nul 2>nul
if %errorlevel% neq 0 (
    echo   Rust not found. Native token counter will use JS fallback.
    echo   Optional: install from https://rustup.rs/ for better performance.
) else (
    for /f "tokens=*" %%v in ('rustc --version') do echo   %%v ok
)

:: 4. Check Git
echo ==^> Checking Git...
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo   Git not found.
    echo   Please install Git from https://git-scm.com/download/win
    echo   Or run: winget install Git.Git
    pause
    exit /b 1
)
echo   Git ok

:: 5. Clone or update
echo ==^> Setting up AURIX Agent...
if exist "%INSTALL_DIR%\.git" (
    echo   Updating existing installation...
    pushd "%INSTALL_DIR%"
    git pull --quiet
    popd
) else (
    if not exist "%USERPROFILE%\.aurix" mkdir "%USERPROFILE%\.aurix"
    echo   Cloning repository...
    git clone "%REPO%" "%INSTALL_DIR%"
    if %errorlevel% neq 0 (
        echo   ERROR: Git clone failed.
        pause
        exit /b 1
    )
)

:: 6. Build
echo ==^> Building...
pushd "%INSTALL_DIR%"
call npm install --silent
if %errorlevel% neq 0 (
    echo   npm install failed, trying bun install...
    call bun install
)
call npm run build
if %errorlevel% neq 0 (
    echo   ERROR: Build failed.
    pause
    popd
    exit /b 1
)
popd

:: 7. Add to PATH
echo ==^> Adding to PATH...
set "BIN_DIR=%INSTALL_DIR%\bin"
echo %PATH% | findstr /i "%BIN_DIR%" >nul
if %errorlevel% neq 0 (
    setx PATH "%PATH%;%BIN_DIR%" >nul 2>nul
    echo   Added %BIN_DIR% to user PATH
    echo   Restart your terminal for PATH changes to take effect.
) else (
    echo   Already in PATH
)

:: 8. Create shortcut
echo ==^> Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%USERPROFILE%\Desktop\AURIX Agent.lnk'); $s.TargetPath = 'cmd.exe'; $s.Arguments = '/k aurix'; $s.WorkingDirectory = '%USERPROFILE%'; $s.Description = 'AURIX AI Agent'; $s.Save()"

echo.
echo   ===================================
echo    AURIX Agent installed!
echo   ===================================
echo.
echo   Run:     aurix
echo   Setup:   aurix setup
echo.
echo   If 'aurix' is not recognized, restart your terminal first.
echo.
pause
