@echo off
REM Builds DeviceMonitorAgent.exe (a single file, no Node.js install needed on the target PC).
REM Run this on a Windows PC that has Node.js 18+ installed (https://nodejs.org).

cd /d "%~dp0"

echo Building DeviceMonitorAgent.exe ...
call npx -y @yao-pkg/pkg agent.js --targets node20-win-x64 --output dist\DeviceMonitorAgent.exe
if errorlevel 1 (
  echo.
  echo Build failed. Make sure Node.js is installed and you have internet access.
  pause
  exit /b 1
)

echo.
echo Done: %~dp0dist\DeviceMonitorAgent.exe
echo Copy that file to the PC you want to monitor and double-click it.
pause
