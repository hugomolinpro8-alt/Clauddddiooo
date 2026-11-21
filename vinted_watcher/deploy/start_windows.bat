@echo off
REM Lance Vinted Watcher sous Windows (utilisable avec le Planificateur de tâches).
cd /d "%~dp0\.."
:loop
".venv\Scripts\python.exe" -m vwatch run
echo Arret du programme, redemarrage dans 60 s... (Ctrl+C pour quitter)
timeout /t 60 /nobreak >nul
goto loop
