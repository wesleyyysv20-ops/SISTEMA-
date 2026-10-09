# =====================================================================
# CENTRAL AUTOMAÇÕES DISPPAR — PASSO 1 (rodar no computador ANTIGO)
# - DISPPAR Atende: desliga, copia os dados (conversas, sessão do WhatsApp,
#   site) e a versão mais nova do programa para o pendrive, e trava este
#   computador para ele não religar o WhatsApp.
# - Cotação: confere se a exportação da nuvem (exportacao-cotacao.json) já
#   está no pendrive (ela é baixada pela própria Cotação, em Configurações > Backup).
# =====================================================================
param([string]$Atende = '', [switch]$Teste)  # -Teste: não desliga nem trava nada (só copia)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CENTRAL DISPPAR - Levar dados para o pendrive'
$raiz = Split-Path -Parent $PSScriptRoot           # ...\CENTRAL-DISPPAR (no pendrive)
$pendPrograma = Join-Path $raiz 'programa'
$pendDados = Join-Path $raiz 'dados'

function Titulo($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Erro($t) { Write-Host ""; Write-Host "  [ERRO] $t" -ForegroundColor Red; Write-Host ""; if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }; exit 1 }
function Pergunta($t) { if ($Teste) { Write-Host "  $t -> (teste: S)"; return $true }; do { $r = Read-Host "  $t (S/N)" } until ($r -match '^[sSnN]$'); return ($r -match '^[sS]$') }

Clear-Host
Write-Host ''
Write-Host '  CENTRAL AUTOMAÇÕES DISPPAR — Passo 1: levar os dados para o pendrive' -ForegroundColor White
Write-Host '  --------------------------------------------------------------------'

# ---------------------------------------------------------------- Cotação (exportação da nuvem)
Titulo '1/4  Cotação: exportação da nuvem'
New-Item -ItemType Directory -Force (Join-Path $pendDados 'cotacao') | Out-Null
$exp = Join-Path $pendDados 'cotacao\exportacao-cotacao.json'
while (-not (Test-Path $exp)) {
  Aviso 'Falta a exportação da Cotação no pendrive.'
  Write-Host '   1. Abra a Cotação (com um usuário ADMINISTRADOR) > Configurações > Backup.'
  Write-Host '   2. Clique em "📦 Exportar para a Central".'
  Write-Host "   3. Salve o arquivo exportacao-cotacao.json em: $(Split-Path $exp)"
  if ($Teste) { Erro 'teste: sem exportação' }
  $r = Read-Host '  Depois de salvar, aperte Enter (ou digite P para pular a Cotação)'
  if ($r -match '^[pP]$') { Aviso 'Cotação pulada: ela vai começar vazia no servidor novo.'; break }
}
if (Test-Path $exp) {
  $info = Get-Item $exp
  try { $j = Get-Content $exp -Raw -Encoding UTF8 | ConvertFrom-Json; $n = @($j.documentos.PSObject.Properties).Count; $u = @($j.usuarios).Count } catch { Erro 'O arquivo exportacao-cotacao.json está estragado. Exporte de novo.' }
  Ok "Exportação de $($info.LastWriteTime.ToString('dd/MM/yyyy HH:mm')): $n documentos e $u usuário(s)"
  if ((Get-Date) - $info.LastWriteTime -gt (New-TimeSpan -Hours 3)) { Aviso 'Essa exportação tem mais de 3 horas. Se a Cotação foi usada depois, exporte de novo para não perder nada.' }
}

# ---------------------------------------------------------------- DISPPAR Atende
$candidatos = @('C:\DISPPAR-Atende', (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ATENDIMENTO WHATSAPP')) |
  Select-Object -Unique | Where-Object { Test-Path (Join-Path $_ 'servidor\dados\atende.db') }
$ativas = $candidatos | Where-Object { -not (Test-Path (Join-Path $_ 'servidor\dados\MIGRADO-NAO-INICIAR.txt')) }
$projeto = if ($Atende) { $Atende } else { (@($ativas) + @($candidatos))[0] }
if (-not $projeto) {
  Aviso 'Não achei o DISPPAR Atende neste computador (pulando).'
} else {
  $servidor = Join-Path $projeto 'servidor'
  $dados = Join-Path $servidor 'dados'
  $nodeExe = if (Test-Path (Join-Path $projeto 'runtime\node.exe')) { Join-Path $projeto 'runtime\node.exe' } elseif (Test-Path (Join-Path $raiz 'runtime\node.exe')) { Join-Path $raiz 'runtime\node.exe' } else { 'node' }
  $info = & $nodeExe --no-warnings (Join-Path $servidor 'ferramentas-banco.js') verificar (Join-Path $dados 'atende.db')
  $c, $u, $a, $integ = "$info".Split('|')
  Write-Host ''
  Write-Host "  DISPPAR Atende encontrado em: $projeto ($c conversas, $u usuário(s))"
  Write-Host '  ATENÇÃO: o Atende será DESLIGADO neste computador agora e este computador fica TRAVADO' -ForegroundColor Yellow
  Write-Host '  (o WhatsApp não pode ficar ligado em dois computadores). Os vendedores ficam sem atendimento'
  Write-Host '  até a Central ser instalada no servidor novo.'
  if (-not (Pergunta 'Continuar?')) { exit 0 }

  Titulo '2/4  DISPPAR Atende: desligando neste computador'
  if ($Teste) { Write-Host '  (teste: NÃO desligado)' } else {
    Stop-ScheduledTask -TaskName 'DISPPAR Atende' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'index\.js' -and $_.ExecutablePath -notlike "$raiz*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -match 'localhost:3210' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'INICIAR\.bat|SERVIDOR\.bat' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Sleep -Seconds 3
  }
  $integ = & $nodeExe --no-warnings (Join-Path $servidor 'ferramentas-banco.js') consolidar (Join-Path $dados 'atende.db')
  if ("$integ" -ne 'ok') { Erro "O banco do Atende está com problema ($integ). Nada foi alterado." }
  Ok 'Atende desligado e banco consolidado'

  Titulo '3/4  DISPPAR Atende: programa e dados para o pendrive'
  foreach ($p in @('servidor', 'painel')) {
    robocopy (Join-Path $projeto $p) (Join-Path $pendPrograma "atende\$p") /MIR /XD dados dados-anterior* .wrangler test /XF *.log *.log.err INICIAR.bat CRIAR-ADMIN.bat /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Erro "Falha ao copiar o programa do Atende ($p)." }
  }
  robocopy $dados (Join-Path $pendDados 'atende') /MIR /XF servidor.log servidor.log.err MIGRADO-NAO-INICIAR.txt /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Erro 'Falha ao copiar os dados do Atende.' }
  $conf = & $nodeExe --no-warnings (Join-Path $servidor 'ferramentas-banco.js') verificar (Join-Path $pendDados 'atende\atende.db')
  $c2, $u2, $a2, $integ2 = "$conf".Split('|')
  if ($integ2 -ne 'ok' -or $c2 -ne $c) { Erro "A cópia do Atende no pendrive não conferiu ($conf). Tente de novo." }
  Ok "Atende no pendrive conferido ($c2 conversas, sessão do WhatsApp e site)"

  Titulo '4/4  Travando este computador (Atende)'
  if ($Teste) { Write-Host '  (teste: NÃO travado)' } else {
    Set-Content -Path (Join-Path $dados 'MIGRADO-NAO-INICIAR.txt') -Encoding UTF8 -Value "Os dados foram levados para a CENTRAL AUTOMAÇÕES DISPPAR em $(Get-Date -Format 'dd/MM/yyyy HH:mm') (pendrive)."
    Unregister-ScheduledTask -TaskName 'DISPPAR Atende' -Confirm:$false -ErrorAction SilentlyContinue
    Get-ChildItem ([Environment]::GetFolderPath('Startup')), ([Environment]::GetFolderPath('CommonStartup')) -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
      $alvo = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName).TargetPath
      if ($alvo -match 'INICIAR\.bat|SERVIDOR\.bat') { Remove-Item $_.FullName -Force; Ok "Removido o início automático ($($_.Name))" }
    }
    Ok 'Este computador não liga mais o Atende'
  }
}

Write-Host ''
Write-Host '  PRONTO! Agora:' -ForegroundColor Green
Write-Host '   1. Tire o pendrive com segurança.'
Write-Host '   2. No servidor NOVO, abra o pendrive > CENTRAL-DISPPAR > INSTALAR-CENTRAL.bat'
Write-Host '   3. Guarde o pendrive com cuidado: ele tem a sessão do WhatsApp e os dados da loja.'
Write-Host ''
if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }
