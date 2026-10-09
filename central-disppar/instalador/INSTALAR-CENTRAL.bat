@echo off
rem CENTRAL AUTOMACOES DISPPAR - instala tudo no servidor NOVO (rode como administrador)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-central.ps1"
