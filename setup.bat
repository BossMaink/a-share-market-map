@echo off
cd /d "%~dp0"

echo.
echo ============================================
echo   A-Share AI Market Map - Setup
echo ============================================
echo.

:: ---- Step 1: check Python ----
echo [1/4] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Python not found. Please install Python 3.10+
    echo   Download: https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do echo   Python %%v - OK

:: ---- Step 2: create venv ----
echo.
echo [2/4] Setting up virtual environment...
if exist .venv\Scripts\python.exe (
    echo   .venv already exists, skipping
) else (
    echo   Creating .venv ...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo   [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
    echo   .venv created - OK
)

:: ---- Step 3: install Python deps ----
echo.
echo [3/4] Installing Python dependencies...
.venv\Scripts\python.exe -m pip install --upgrade pip -q
.venv\Scripts\python.exe -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo   [ERROR] pip install failed
    pause
    exit /b 1
)
echo   Python dependencies installed - OK

:: ---- Step 4: install Node deps ----
echo.
echo [4/4] Installing Node.js dependencies...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [SKIP] Node.js not found. Dev server unavailable.
    echo   Install Node.js from: https://nodejs.org/
) else (
    call npm install
    if %errorlevel% neq 0 (
        echo   [WARN] npm install failed, retry later
    ) else (
        echo   Node.js dependencies installed - OK
    )
)

:: ---- Done ----
echo.
echo ============================================
echo   Setup complete!
echo.
echo   Next steps:
echo     1. Double-click update-data.bat   (fetch latest data)
echo     2. Double-click start.bat         (launch dev server)
echo ============================================
echo.
pause
