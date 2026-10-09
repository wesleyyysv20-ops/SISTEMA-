# =====================================================================
# CENTRAL AUTOMAÇÕES DISPPAR — cópia de segurança no pendrive
# Copia os programas e os dados da Central (Cotação e Atende) para o pendrive
# com TUDO LIGADO (os bancos são copiados de forma segura, sem travar nada).
# Com esse pendrive dá para reinstalar a Central em outro servidor.
# =====================================================================
param([string]$Central = 'C:\DISPPAR-Central', [switch]$Teste)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CENTRAL DISPPAR - Copia no pendrive'
$raiz = Split-Path -Parent $PSScriptRoot
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Erro($t) { Write-Host ""; Write-Host "  [ERRO] $t" -ForegroundColor Red; if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }; exit 1 }

if (-not (Test-Path (Join-Path $Central 'central\vigia.js'))) { Erro "Não achei a Central em $Central." }
$node = Join-Path $Central 'runtime\node.exe'
$pendDados = Join-Path $raiz 'dados'
Write-Host ''
Write-Host '  CENTRAL AUTOMAÇÕES DISPPAR — cópia no pendrive' -ForegroundColor White

# programas (versão instalada)
robocopy $Central (Join-Path $raiz 'programa') /MIR /XD dados dados-anterior* runtime gerenciar /XF CENTRAL.bat *.log /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Erro 'Falha ao copiar os programas.' }
Ok 'Programas'

# dados: tudo menos os bancos abertos e os logs; depois os bancos, copiados com segurança
robocopy (Join-Path $Central 'dados') $pendDados /MIR /XD logs backups /XF *.db *.db-wal *.db-shm *.log /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Erro 'Falha ao copiar os dados.' }
foreach ($b in @(@{ n = 'Cotação'; o = 'cotacao\cotacao.db' }, @{ n = 'DISPPAR Atende'; o = 'atende\atende.db' })) {
  $origem = Join-Path $Central "dados\$($b.o)"
  if (-not (Test-Path $origem)) { continue }
  $destino = Join-Path $pendDados $b.o
  New-Item -ItemType Directory -Force (Split-Path $destino) | Out-Null
  $r = & $node --no-warnings (Join-Path $Central 'central\ferramentas.js') copiar-banco $origem $destino
  if ("$r" -ne 'ok') { Erro "Falha ao copiar o banco da $($b.n)." }
  Ok "$($b.n): banco copiado"
}
Set-Content -Path (Join-Path $pendDados 'backup-externo.txt') -Encoding UTF8 -Value "Cópia da Central feita em $(Get-Date -Format 'dd/MM/yyyy HH:mm') no computador $env:COMPUTERNAME"
Write-Host ''
Write-Host '  PRONTO! Cópia no pendrive atualizada.' -ForegroundColor Green
if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }
