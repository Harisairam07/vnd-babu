@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE=%cd%\.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
  set "PYTHON_EXE=python"
)

echo Starting FastAPI server on http://localhost:10000 ...
start "VND Babu API" cmd /k "%PYTHON_EXE% -m uvicorn main:app --host 0.0.0.0 --port 10000 --reload"

timeout /t 2 /nobreak >nul

start "" http://localhost:10000
start "" http://localhost:10000/admin.html

echo.
echo Website: http://localhost:10000
echo Admin:   http://localhost:10000/admin.html
echo API:     http://localhost:10000/api/health
