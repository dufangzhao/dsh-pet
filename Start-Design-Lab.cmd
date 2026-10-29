@echo off
setlocal
title AI Pet - Start Design Lab
cd /d "%~dp0"
node "apps\desktop\start.mjs" --start-design-lab --show-settings
exit /b %errorlevel%
