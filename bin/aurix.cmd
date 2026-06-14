@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0.."
set "DIST=%SCRIPT_DIR%\dist\index.js"

for /f "tokens=*" %%i in ('node -e "console.log(require('%SCRIPT_DIR%\package.json').version)" 2^>nul') do set VERSION=%%i
if not defined VERSION set VERSION=0.1.0

set "AURIX_HOME=%SCRIPT_DIR%"

if not exist "%DIST%" (
    echo building...
    pushd "%SCRIPT_DIR%"
    npx tsc >nul 2>nul
    popd
)

set "RUNTIME="

where bun >nul 2>nul
if %errorlevel% equ 0 (
    set "RUNTIME=bun"
    goto :run
)

where node >nul 2>nul
if %errorlevel% equ 0 (
    set "RUNTIME=node"
    goto :run
)

echo error: node or bun is required
echo   install node: https://nodejs.org
echo   install bun:  npm install -g bun
exit /b 1

:run
if "%~1"=="-h" goto :help
if "%~1"=="--help" goto :help
if "%~1"=="help" goto :help
if "%~1"=="-v" goto :version
if "%~1"=="--version" goto :version
if "%~1"=="version" goto :version
goto :exec

:help
echo.
echo   AURIX v%VERSION% — agentic ai terminal workspace
echo.
echo   Usage: aurix [command] [options]
echo.
echo   Commands:
echo     (default)      Start interactive session
echo     setup          Configure provider, API key, model
echo     gateway        Start messaging gateway
echo     sessions       List saved sessions
echo.
echo   Options:
echo     --resume ^<id^>   Resume a previous session
echo     --continue      Continue last session
echo     --setup         Force setup wizard
echo     -v, --version   Show version
echo     -h, --help      Show help
echo.
exit /b 0

:version
echo aurix v%VERSION%
exit /b 0

:exec
%RUNTIME% "%DIST%" %*
exit /b %errorlevel%
