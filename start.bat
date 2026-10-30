@echo off
cd /d "%~dp0"

call npm run build
if errorlevel 1 goto finished

call npm start

:finished
echo.
echo Steam Hour Farmer has stopped.
pause
