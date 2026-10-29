@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  call npm.cmd install
  if errorlevel 1 exit /b %errorlevel%
)
call npm.cmd run dev
exit /b %errorlevel%
