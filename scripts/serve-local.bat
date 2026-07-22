@echo off
REM FUMOCA — one-command local server for testing (Windows).
REM
REM WHY THIS EXISTS: this app uses ES modules for most interactive JS.
REM Browsers refuse to load ES modules over the file:// protocol — that's
REM what happens when you double-click an .html file to open it. It's a
REM real browser security restriction, not a bug here. The page will show
REM correct styling but everything interactive (uploads, feed, nav user
REM info) will silently fail, which looks like "everything is broken."
REM
REM Usage: double-click this file, or run it from a terminal:
REM   scripts\serve-local.bat [port]
REM Then open the URL it prints in your browser — do NOT double-click any
REM .html file directly.

setlocal
set PORT=%1
if "%PORT%"=="" set PORT=8000

cd /d "%~dp0.."

echo ================================================================
echo  FUMOCA local server
echo  Serving: %cd%
echo  URL:     http://localhost:%PORT%/feed.html
echo           (or /index.html, /upload.html, etc.)
echo.
echo  Press Ctrl+C to stop.
echo ================================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python -m http.server %PORT%
    goto :eof
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -m http.server %PORT%
    goto :eof
)

where npx >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    npx --yes serve -l %PORT% .
    goto :eof
)

echo No Python or Node found. Install Python from python.org (check
echo "Add python.exe to PATH" during install), then run this file again.
pause
