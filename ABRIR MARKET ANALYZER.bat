@echo off
title MARKET ANALYZER
cd /d "%~dp0"

echo ===============================================
echo           M A R K E T   A N A L Y Z E R
echo ===============================================
echo.
echo Deixe esta janela ABERTA enquanto usar o programa.
echo Para encerrar, feche esta janela.
echo.

rem --- 1) Tenta Python (mais rapido e estavel) ---
set PY=
where py >nul 2>&1 && set PY=py
if "%PY%"=="" (where python >nul 2>&1 && set PY=python)

if not "%PY%"=="" (
  echo Servidor local: http://localhost:8777
  start "" http://localhost:8777/index.html
  %PY% -m http.server 8777 --bind 127.0.0.1
  goto :eof
)

rem --- 2) Sem Python: usa o PowerShell (ja vem no Windows) ---
echo Python nao encontrado - usando o servidor do PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o servidor local.
  echo Instale o Python em https://www.python.org/downloads/
  echo (marque "Add Python to PATH" na instalacao) e tente de novo.
  pause
)
