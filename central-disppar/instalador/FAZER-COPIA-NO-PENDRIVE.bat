@echo off
rem CENTRAL AUTOMACOES DISPPAR - copia de seguranca dos dados da Central para o pendrive (com tudo ligado)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\copiar-dados.ps1"
