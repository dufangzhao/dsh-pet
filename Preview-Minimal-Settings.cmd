@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0qa/minimal-settings-preview/index.html"
exit /b %errorlevel%
