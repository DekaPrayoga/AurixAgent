@echo off
setlocal enabledelayedexpansion
title AURIX Agent - Installer

echo.
echo   AURIX Agent - Installer (Windows)
echo.

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

:: 2. Install via npm (postinstall hook handles native pkg + Bun hints)
echo ==^> Installing aurix-ai from npm...
call npm install -g aurix-ai@latest
if %errorlevel% neq 0 (
    echo   ERROR: npm install failed.
    pause
    exit /b 1
)

:: 3. Verify
echo ==^> Verifying...
where aurix >nul 2>nul
if %errorlevel% neq 0 (
    echo   WARNING: 'aurix' not found in PATH.
    echo   Restart your terminal or add npm's global bin to PATH.
    echo   (npm config get prefix to see where it was installed)
) else (
    echo   aurix installed successfully
)

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
