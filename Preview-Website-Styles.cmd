@echo off
setlocal
title AI Pet - Website Style Previews
cd /d "%~dp0"
start "" "%~dp0qa/website-style-previews/index.html"
exit /b %errorlevel%
