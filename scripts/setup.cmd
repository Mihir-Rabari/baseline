@echo off
REM ==============================================================================
REM Production Starter - Windows CMD Wrapper
REM ==============================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Setup script encountered an error.
    exit /b %ERRORLEVEL%
)
