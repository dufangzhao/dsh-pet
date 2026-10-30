@echo off
setlocal
title AI Pet - Website-sourced Foundation
cd /d "%~dp0"
node "apps/desktop/start.mjs" --demo-acceptance=website-source-preview --show-settings
exit /b %errorlevel%
