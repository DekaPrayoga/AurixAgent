@echo off
setlocal

set "SCRIPT_DIR=%~dp0.."
set "DIST=%SCRIPT_DIR%\dist\index.js"

for /f "tokens=*" %%i in ('node -e "console.log(require('%SCRIPT_DIR%\package.json').version)"') do set VERSION=%%i

set "AURIX_HOME=%SCRIPT_DIR%"

if not exist "%DIST%" (
    echo building...
    pushd "%SCRIPT_DIR%" && npx tsc >nul 2>nul && popd
)

where bun >nul 2>nul
if %errorlevel% equ 0 (
    bun "%DIST%" %*
) else (
    echo error: bun is required (OpenTUI needs bun runtime)
    echo   install bun: npm install -g bun
    exit /b 1
)
