@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Ambiente Python nao encontrado. Consulte README.md.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" verificar_apresentacao.py
if errorlevel 1 (
  echo Corrija os itens acima antes de iniciar.
  pause
  exit /b 1
)
if not defined SCANNER_PORT set "SCANNER_PORT=5002"
set "SCANNER_RELOAD=0"
echo.
echo VITRINE 3D - Mercado Boa Vizinhanca
echo Abra no computador: http://127.0.0.1:%SCANNER_PORT%
echo Mantenha esta janela aberta durante a demonstracao.
echo.
".venv\Scripts\python.exe" app.py
pause
