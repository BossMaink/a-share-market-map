@echo off
cd /d "%~dp0"

echo.
echo ============================================
echo   A-Share AI Market Map - Update Data
echo ============================================
echo.

:: Check for local venv (created by setup.bat)
if not exist .venv\Scripts\python.exe (
    echo [ERROR] Virtual environment not found.
    echo Please run setup.bat first.
    echo.
    pause
    exit /b 1
)

:: Quick dependency check
.venv\Scripts\python.exe -c "import akshare; import requests" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python dependencies missing. Please run setup.bat first.
    pause
    exit /b 1
)

echo Fetching latest market data...
echo ~5500 stocks, estimated 5-15 minutes
echo.

.venv\Scripts\python.exe scripts\update-a-share-data.py

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   Update complete!
    echo   Double-click start.bat to launch
    echo ============================================
) else (
    echo.
    echo [WARN] Update failed (exit code %errorlevel%). Retry or use old data.
)

echo.
pause
