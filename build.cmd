@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run dist:win
exit /b %errorlevel%
