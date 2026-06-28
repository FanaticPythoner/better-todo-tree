@echo off
set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..\..") do set REPO=%%~fI
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%issue55_101_winboat_repro.ps1" -Repo "%REPO%" -OutDir "%SCRIPT_DIR%"
exit /b %ERRORLEVEL%
