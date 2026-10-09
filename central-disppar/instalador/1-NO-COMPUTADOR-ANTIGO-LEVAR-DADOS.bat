@echo off
rem CENTRAL AUTOMACOES DISPPAR - passo 1, no computador ANTIGO: leva os dados para o pendrive
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\levar-dados.ps1"
