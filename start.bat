@echo off
cd /d "%~dp0"

echo.
echo ============================================
echo   A-Share AI Market Map - Start
echo ============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    echo Install from: https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo First run: installing Node.js dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo.
)

echo Starting dev server...
echo Open http://localhost:5173 in your browser
echo Press Ctrl+C to stop
echo.

npx vite --host
pause
