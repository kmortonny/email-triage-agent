@echo off
REM Email Triage Agent - Windows installer launcher.
REM Double-click this file to run the wizard.

setlocal

cd /d "%~dp0"

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo PowerShell was not found on this PC. Install PowerShell 5.1+ or 7+ and try again.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
  echo Installer exited with code %EXITCODE%.
) else (
  echo Installer finished. You can close this window.
)
pause
exit /b %EXITCODE%
