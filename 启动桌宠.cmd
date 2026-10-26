@echo off
rem ASCII avoids UTF-8 batch prompts being truncated after Electron exits.
setlocal
title AI Pet - Preview
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" goto missing-runtime
if not exist "apps\desktop\dist\main\index.mjs" goto missing-build
if not exist "apps\desktop\dist\renderer\console\index.html" goto missing-build

set "ELECTRON_RUN_AS_NODE="
echo Starting AI Pet. Click Settings in the pet panel.
"node_modules\electron\dist\electron.exe" %* "apps\desktop"
set "PET_LAUNCH_EXIT=%errorlevel%"
if "%PET_LAUNCH_EXIT%"=="0" exit /b 0
rem Both values have occurred during sandbox startup in the dev runner.
if "%PET_LAUNCH_EXIT%"=="3" goto compatibility
if "%PET_LAUNCH_EXIT%"=="-2147483645" goto compatibility
goto failed

:compatibility
echo.
echo Standard launch failed. Exit code: %PET_LAUNCH_EXIT%.
choice /c YN /n /m "Retry local preview with sandbox disabled for this run? [Y/N] "
if not "%errorlevel%"=="1" exit /b %PET_LAUNCH_EXIT%
"node_modules\electron\dist\electron.exe" --no-sandbox %* "apps\desktop"
set "PET_LAUNCH_EXIT=%errorlevel%"
if "%PET_LAUNCH_EXIT%"=="0" exit /b 0
goto failed

:missing-runtime
echo Runtime missing. Run pnpm install --ignore-scripts in this folder.
set "PET_LAUNCH_EXIT=1"
goto failed

:missing-build
echo Build missing. Run pnpm build in this folder.
set "PET_LAUNCH_EXIT=1"
goto failed

:failed
echo.
echo AI Pet could not start or exit normally. Exit code: %PET_LAUNCH_EXIT%.
echo Keep the error messages in this window.
pause
exit /b %PET_LAUNCH_EXIT%
