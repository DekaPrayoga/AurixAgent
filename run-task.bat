@echo off
REM AURIX Task Runner - Windows
REM Usage: run-task.bat "your task here" [--gui] [--proxy=host:port:user:pass]

if "%~1"=="" (
    echo.
    echo AURIX Task Runner
    echo.
    echo Usage: run-task.bat "task description" [--gui] [--proxy=host:port:user:pass]
    echo.
    echo Examples:
    echo   run-task.bat "Go to example.com and fill the signup form"
    echo   run-task.bat "Solve the CAPTCHA on google.com/recaptcha/api2/demo" --gui
    echo   run-task.bat "Navigate to github.com" --proxy=1.2.3.4:8080:user:pass
    echo.
    echo Logs saved to: logs\ folder
    exit /b 0
)

node "%~dp0scripts\run-task.mjs" %*
