# =====================================================================
# CENTRAL AUTOMAÇÕES DISPPAR — INSTALADOR ÚNICO
# Instala, de uma vez, a Central com os seus sistemas (Cotação e DISPPAR Atende)
# como UM serviço do Windows que liga sozinho com o servidor (sem ninguém logado).
# Cada sistema roda separado: se um parar, o outro continua.
# Usa o Node.js e o cloudflared do pendrive (pasta "runtime"): não baixa nada.
# =====================================================================
param([string]$Destino = 'C:\DISPPAR-Central', [switch]$Teste, [string]$NomeTarefa = 'Central Automacoes DISPPAR')
$ErrorActionPreference = 'Stop'
$osVer = [Environment]::OSVersion.Version
if ($osVer.Major -lt 10) {
  [Console]::WriteLine('')
  [Console]::WriteLine("ERRO: este Windows e antigo demais (versao $osVer).")
  [Console]::WriteLine('A Central precisa de Windows 10/11 ou Windows Server 2016, 2019, 2022 ou mais novo.')
  if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }
  exit 1
}
trap {
  Write-Host ''
  Write-Host "  [ERRO INESPERADO] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  (linha $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim()))" -ForegroundColor DarkGray
  try { Stop-Transcript | Out-Null } catch { }
  if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }
  exit 1
}
$ehAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ehAdmin -and -not $Teste) {
  Write-Host '  Pedindo permissão de Administrador...'
  Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"")
  exit 0
}
$Host.UI.RawUI.WindowTitle = 'CENTRAL AUTOMACOES DISPPAR - Instalador'
$raiz = Split-Path -Parent $PSScriptRoot          # ...\CENTRAL-DISPPAR (no pendrive)
try { Start-Transcript -Path (Join-Path $raiz 'instalar-central.log') -Append | Out-Null } catch { }
$origemPrograma = Join-Path $raiz 'programa'
$origemDados = Join-Path $raiz 'dados'
$origemRuntime = Join-Path $raiz 'runtime'

function Titulo($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Erro($t) { Write-Host ""; Write-Host "  [ERRO] $t" -ForegroundColor Red; Write-Host ""; if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }; exit 1 }
function Pergunta($t, $padrao = $false) { if ($Teste) { Write-Host "  $t -> (teste: N)"; return $false }; $dica = if ($padrao) { 'S/n' } else { 's/N' }; do { $r = Read-Host "  $t ($dica)" } until ($r -match '^[sSnN]?$'); if ($r -eq '') { return $padrao }; return ($r -match '^[sS]$') }
function Ascii($caminho, $texto) { [IO.File]::WriteAllText($caminho, ($texto -replace "`r?`n", "`r`n"), [Text.Encoding]::ASCII) }

Clear-Host
Write-Host ''
Write-Host '  CENTRAL AUTOMAÇÕES DISPPAR — Instalação' -ForegroundColor White
Write-Host '  Cotação + DISPPAR Atende, cada um independente, num serviço só'
Write-Host '  ----------------------------------------------------------------'

# ---------------------------------------------------------------- 0. Conferências
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
Write-Host "  Sistema: $($os.Caption) (build $build)"
if ($build -lt 14393) { Erro "Este Windows é antigo demais (build $build). Precisa do Windows Server 2016 ou mais novo (ou Windows 10/11)." }
if (-not [Environment]::Is64BitOperatingSystem) { Erro 'A Central precisa de Windows de 64 bits.' }
if (-not (Test-Path (Join-Path $origemPrograma 'central\vigia.js'))) { Erro "Não achei o programa em $origemPrograma. Rode este instalador de dentro da pasta CENTRAL-DISPPAR do pendrive." }
$temAtende = Test-Path (Join-Path $origemPrograma 'atende\servidor\index.js')
$temCotacao = Test-Path (Join-Path $origemPrograma 'cotacao\servidor\index.js')
if ($temAtende -and -not (Test-Path (Join-Path $origemPrograma 'atende\servidor\node_modules\@whiskeysockets'))) { Erro 'Faltam os componentes do DISPPAR Atende (node_modules) no pendrive. Peça um pendrive atualizado.' }
Write-Host "  Sistemas no pendrive: $(@($(if ($temCotacao) { 'Cotação' }), $(if ($temAtende) { 'DISPPAR Atende' })) -join ' + ')"

if (-not $Teste) {
  Write-Host ''
  $pasta = Read-Host "  Pasta de instalação [$Destino] (Enter para aceitar)"
  if ($pasta.Trim()) { $Destino = $pasta.Trim().Trim('"') }
}
$dadosDestino = Join-Path $Destino 'dados'
$rtDestino = Join-Path $Destino 'runtime'
$gerenciar = Join-Path $Destino 'gerenciar'
$registroInstalacoes = Join-Path $origemDados 'INSTALADO-EM.txt'

# dados que vieram do computador antigo
$dbAtende = Join-Path $origemDados 'atende\atende.db'
$expCotacao = Join-Path $origemDados 'cotacao\exportacao-cotacao.json'
$dbCotacao = Join-Path $origemDados 'cotacao\cotacao.db'
Write-Host ''
if (Test-Path $dbAtende) { Ok "DISPPAR Atende: dados do computador antigo encontrados ($((Get-Item $dbAtende).LastWriteTime.ToString('dd/MM/yyyy HH:mm')))" } else { Aviso 'DISPPAR Atende: o pendrive NÃO tem os dados do computador antigo (rode o LEVAR-DADOS.bat lá antes, se for uma mudança).' }
if (Test-Path $dbCotacao) { Ok 'Cotação: banco do servidor local encontrado (de uma Central anterior)' }
elseif (Test-Path $expCotacao) { Ok "Cotação: exportação da nuvem encontrada ($((Get-Item $expCotacao).LastWriteTime.ToString('dd/MM/yyyy HH:mm')))" }
else { Aviso 'Cotação: o pendrive NÃO tem a exportação da nuvem (exportacao-cotacao.json). A Cotação vai começar vazia.' }
if (Test-Path $registroInstalacoes) {
  Aviso 'Estes dados JÁ FORAM INSTALADOS antes:'
  Get-Content $registroInstalacoes -Encoding UTF8 | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
  Write-Host '  Cada sistema só pode ficar LIGADO EM UM computador (o WhatsApp do Atende cai se ligar em dois).'
}
if (-not $Teste -and -not (Pergunta 'Continuar a instalação?' $true)) { exit 0 }

# ---------------------------------------------------------------- 1. Node.js e cloudflared
Titulo '1/6  Node.js e cloudflared (do pendrive, sem baixar nada)'
function ConferirPrograma($arquivo, $emissor) {
  if (-not (Test-Path $arquivo)) { return "faltando: $arquivo" }
  $s = Get-AuthenticodeSignature $arquivo
  if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch $emissor) { return "assinatura digital inválida em $arquivo" }
  return $null
}
$problema = (ConferirPrograma (Join-Path $origemRuntime 'node.exe') 'OpenJS Foundation'); if (-not $problema) { $problema = ConferirPrograma (Join-Path $origemRuntime 'cloudflared.exe') 'Cloudflare' }
if ($problema) { Erro "Pasta runtime do pendrive: $problema" }
New-Item -ItemType Directory -Force $rtDestino | Out-Null
if (-not $Teste) { Stop-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$rtDestino\*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Copy-Item (Join-Path $origemRuntime '*') $rtDestino -Force
$nodeExe = Join-Path $rtDestino 'node.exe'
$versaoNode = (& $nodeExe -v) 2>$null
if ($versaoNode -notmatch 'v(\d+)\.(\d+)' -or [version]"$($Matches[1]).$($Matches[2])" -lt [version]'22.5') { Erro "O Node.js não funcionou neste Windows (resposta: '$versaoNode'). Pode faltar o 'Visual C++ Redistributable 2015-2022 (x64)'." }
Ok "Node.js $versaoNode e cloudflared em $rtDestino"

# ---------------------------------------------------------------- 2. Programas
Titulo "2/6  Copiando os programas para $Destino"
if (Test-Path $dadosDestino) {
  $guardar = Join-Path $Destino ('dados-anterior-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  if ((Get-ChildItem $dadosDestino -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    Aviso "Já existe uma Central instalada em $Destino com dados."
    if (-not $Teste -and -not (Pergunta 'Substituir? (os dados atuais ficam guardados numa pasta "dados-anterior")')) { exit 0 }
    Move-Item $dadosDestino $guardar
    Ok "Dados anteriores guardados em $guardar"
  }
}
New-Item -ItemType Directory -Force $Destino | Out-Null
robocopy $origemPrograma $Destino /E /XD dados /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Erro 'Falha ao copiar os programas (robocopy).' }
Ok 'Programas copiados'

# ---------------------------------------------------------------- 3. Dados
Titulo '3/6  Dados de cada sistema'
New-Item -ItemType Directory -Force (Join-Path $dadosDestino 'cotacao'), (Join-Path $dadosDestino 'atende'), (Join-Path $dadosDestino 'central'), (Join-Path $dadosDestino 'logs') | Out-Null
if (Test-Path $origemDados) {
  robocopy $origemDados $dadosDestino /E /XF INSTALADO-EM.txt exportacao-cotacao.json /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Erro 'Falha ao copiar os dados (robocopy).' }
  Get-ChildItem $dadosDestino -Recurse -Filter 'MIGRADO-NAO-INICIAR.txt' -ErrorAction SilentlyContinue | Remove-Item -Force
}
# DISPPAR Atende
if ($temAtende) {
  $adb = Join-Path $dadosDestino 'atende\atende.db'
  if (Test-Path $adb) {
    $check = & $nodeExe --no-warnings (Join-Path $Destino 'atende\servidor\ferramentas-banco.js') verificar $adb
    $c, $u, $a, $integ = "$check".Split('|')
    if ($integ -ne 'ok') { Erro "O banco do Atende está com problema ($integ). Rode o LEVAR-DADOS.bat de novo no computador antigo." }
    Ok "DISPPAR Atende: $c conversas e $u usuário(s)"
    if (Test-Path (Join-Path $dadosDestino 'atende\sessao-whatsapp\creds.json')) { Ok 'DISPPAR Atende: sessão do WhatsApp (sem QR)' } else { Aviso 'DISPPAR Atende: sem sessão do WhatsApp — vai pedir o QR na primeira vez' }
  } elseif (-not $Teste) {
    Write-Host '  DISPPAR Atende novo: crie o administrador:' -ForegroundColor Yellow
    Push-Location (Join-Path $Destino 'atende\servidor'); $env:PASTA_DADOS = Join-Path $dadosDestino 'atende'; & $nodeExe --no-warnings criar-admin.js; Pop-Location
  }
}
# Cotação
if ($temCotacao) {
  $env:PASTA_DADOS = Join-Path $dadosDestino 'cotacao'
  Push-Location (Join-Path $Destino 'cotacao\servidor')
  if ((Test-Path (Join-Path $dadosDestino 'cotacao\cotacao.db'))) {
    Ok 'Cotação: banco copiado do pendrive'
  } elseif (Test-Path $expCotacao) {
    & $nodeExe --no-warnings importar.js $expCotacao
    if ($LASTEXITCODE -ne 0) { Pop-Location; Erro 'Não consegui importar os dados da Cotação (veja a mensagem acima).' }
    $senhas = Join-Path $dadosDestino 'cotacao\senhas-provisorias.txt'
    if (Test-Path $senhas) { Aviso "Senhas provisórias da Cotação em: $senhas (entregue a cada pessoa; ela troca depois)" }
  }
  $admins = & $nodeExe --no-warnings -e "import('./banco.js').then(b => console.log(b.contarAdmins()))" --input-type=module
  if ([int]"$admins" -eq 0 -and -not $Teste) {
    Write-Host '  Cotação sem administrador. Crie o seu agora:' -ForegroundColor Yellow
    $em = Read-Host '  E-mail'; $sn = Read-Host '  Senha (mín. 6)'
    & $nodeExe --no-warnings criar-admin.js $em $sn
  }
  Pop-Location
  Remove-Item Env:PASTA_DADOS -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- 4. Comandos de controle
Titulo '4/6  Comandos de controle'
New-Item -ItemType Directory -Force $gerenciar | Out-Null
$nomeCmd = '"' + $NomeTarefa + '"'
Ascii (Join-Path $Destino 'CENTRAL.bat') @'
@echo off
rem CENTRAL AUTOMACOES DISPPAR - roda em segundo plano (chamado pela tarefa do Windows)
cd /d "%~dp0"
set "LOG=%~dp0dados\logs\central.log"
if not exist "%~dp0dados\logs" mkdir "%~dp0dados\logs"
:inicio
for %%F in ("%LOG%") do if exist "%%~F" if %%~zF GTR 10485760 move /y "%LOG%" "%LOG%.1" >nul
echo [%date% %time%] iniciando a Central >> "%LOG%"
"%~dp0runtime\node.exe" --no-warnings central\vigia.js >> "%LOG%" 2>&1
if %errorlevel%==2 (
  echo [%date% %time%] A CENTRAL JA ESTA LIGADA OU NAO INICIOU - veja acima >> "%LOG%"
  exit /b 0
)
echo [%date% %time%] a Central parou; religando em 10 segundos >> "%LOG%"
ping -n 11 127.0.0.1 >nul
goto inicio
'@
$elevar = @'
@echo off
fltmc >nul 2>&1
if %errorlevel% neq 0 (
  echo Pedindo permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
'@
$parar = "powershell -NoProfile -Command `"Get-CimInstance Win32_Process | Where-Object { `$_.ExecutablePath -like '$rtDestino\*' -or (`$_.Name -eq 'cmd.exe' -and `$_.CommandLine -match 'CENTRAL\.bat') } | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force }`""
Ascii (Join-Path $gerenciar 'LIGAR.bat') ($elevar + "schtasks /run /tn $nomeCmd`r`necho Ligando a Central em segundo plano. Veja com STATUS.bat em alguns segundos.`r`npause`r`n")
Ascii (Join-Path $gerenciar 'DESLIGAR.bat') ($elevar + "echo Desligando a Central (Cotacao e Atende)...`r`nschtasks /end /tn $nomeCmd >nul 2>&1`r`n$parar`r`necho Desligada. Ela volta sozinha quando o servidor reiniciar (ou use LIGAR.bat).`r`npause`r`n")
Ascii (Join-Path $gerenciar 'REINICIAR.bat') ($elevar + "echo Reiniciando a Central...`r`nschtasks /end /tn $nomeCmd >nul 2>&1`r`n$parar`r`nping -n 6 127.0.0.1 >nul`r`nschtasks /run /tn $nomeCmd`r`necho Pronto. Em ~30 segundos os sistemas voltam.`r`npause`r`n")
Ascii (Join-Path $gerenciar 'ABRIR-CENTRAL.bat') "@echo off`r`nstart http://localhost:3200`r`n"
Ascii (Join-Path $gerenciar 'STATUS.bat') @"
@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "`$t = Get-ScheduledTask -TaskName '$NomeTarefa' -ErrorAction SilentlyContinue; Write-Host ('Servico do Windows: ' + `$(if (`$t) { `$t.State } else { 'NAO EXISTE' })); try { `$s = Invoke-RestMethod 'http://localhost:3200/api/central/status' -TimeoutSec 4; foreach (`$x in `$s.sistemas) { Write-Host ((`$x.nome).PadRight(16) + ': ' + `$x.status + `$(if (`$x.link) { '   ' + `$x.link } else { '' })) } } catch { Write-Host 'Central: FORA DO AR' -ForegroundColor Red }; Write-Host ''; Write-Host '--- ultimas linhas do log da Central ---'; Get-Content '$dadosDestino\logs\central.log' -Tail 15 -ErrorAction SilentlyContinue"
pause
"@
Ascii (Join-Path $gerenciar 'VER-LOG-COTACAO.bat') "@echo off`r`npowershell -NoProfile -Command `"Get-Content '$dadosDestino\logs\cotacao.log' -Tail 60 -Wait`"`r`n"
Ascii (Join-Path $gerenciar 'VER-LOG-ATENDE.bat') "@echo off`r`npowershell -NoProfile -Command `"Get-Content '$dadosDestino\logs\atende.log' -Tail 60 -Wait`"`r`n"
Ascii (Join-Path $gerenciar 'CRIAR-ADMIN-COTACAO.bat') "@echo off`r`nchcp 65001 >nul`r`ncd /d `"$Destino\cotacao\servidor`"`r`nset `"PASTA_DADOS=$dadosDestino\cotacao`"`r`nset /p EM=E-mail: `r`nset /p SN=Senha (min. 6): `r`n`"$nodeExe`" --no-warnings criar-admin.js %EM% %SN%`r`npause`r`n"
Ascii (Join-Path $gerenciar 'REMOVER-INICIO-AUTOMATICO.bat') ($elevar + "echo Isto faz o servidor NAO ligar mais a Central sozinho (use na mudanca para outro computador).`r`npause`r`nschtasks /end /tn $nomeCmd >nul 2>&1`r`n$parar`r`nschtasks /delete /tn $nomeCmd /f`r`necho Pronto.`r`npause`r`n")
Ok "Comandos em $gerenciar (LIGAR, DESLIGAR, REINICIAR, STATUS, logs)"

# ---------------------------------------------------------------- 5. Serviço do Windows
Titulo '5/6  Início automático (um serviço só para a Central inteira)'
$bat = Join-Path $Destino 'CENTRAL.bat'
$acao = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $Destino
$gatilho = New-ScheduledTaskTrigger -AtStartup
$gatilho.Delay = 'PT30S'
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
if ($Teste) {
  Write-Host '  (teste: o serviço NÃO foi registrado)'
} else {
  # o DISPPAR Atende antigo (instalado sozinho neste mesmo computador) sai de cena: agora é a Central que liga
  foreach ($velha in @('DISPPAR Atende')) {
    if (Get-ScheduledTask -TaskName $velha -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $velha -ErrorAction SilentlyContinue
      Disable-ScheduledTask -TaskName $velha -ErrorAction SilentlyContinue | Out-Null
      Aviso "A tarefa antiga '$velha' foi DESATIVADA (a Central assume)."
    }
  }
  Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Settings $config -Principal $principal -Force `
    -Description 'CENTRAL AUTOMACOES DISPPAR: Cotacao + DISPPAR Atende (cada um separado; liga sozinho com o Windows).' | Out-Null
  Ok "Serviço '$NomeTarefa' criado: liga 30 s depois que o servidor iniciar, sem ninguém logado"
}

# ---------------------------------------------------------------- 6. Final
Titulo '6/6  Ajustes finais'
if (-not $Teste) {
  if ((Get-TimeZone).Id -ne 'E. South America Standard Time' -and (Pergunta 'Ajustar o fuso do servidor para o horário de Brasília?' $true)) { Set-TimeZone -Id 'E. South America Standard Time'; Ok 'Fuso: Brasília' }
  try { powercfg /change standby-timeout-ac 0 | Out-Null; powercfg /change hibernate-timeout-ac 0 | Out-Null } catch { }
  Set-Content -Path (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Central Automacoes DISPPAR.url') -Value "[InternetShortcut]`r`nURL=http://localhost:3200" -Encoding ASCII
  Ok 'Atalho da Central na área de trabalho'
  Add-Content -Path $registroInstalacoes -Encoding UTF8 -Value "Central no servidor $env:COMPUTERNAME, pasta $Destino, em $(Get-Date -Format 'dd/MM/yyyy HH:mm')" -ErrorAction SilentlyContinue
  if (Pergunta 'Ligar a Central agora?' $true) {
    Start-ScheduledTask -TaskName $NomeTarefa
    Write-Host '  Aguardando os sistemas subirem...'
    $s = $null
    foreach ($i in 1..60) { Start-Sleep -Seconds 2; try { $s = Invoke-RestMethod 'http://localhost:3200/api/central/status' -TimeoutSec 3; if (($s.sistemas | Where-Object { $_.status -ne 'no ar' }).Count -eq 0) { break } } catch { } }
    if ($s) { foreach ($x in $s.sistemas) { if ($x.status -eq 'no ar') { Ok "$($x.nome): no ar" } else { Aviso "$($x.nome): $($x.status) (veja gerenciar\STATUS.bat)" } } }
    else { Aviso "A Central ainda não respondeu. Veja $dadosDestino\logs\central.log" }
    Start-Process 'http://localhost:3200'
  }
}
Write-Host ''
Write-Host '  PRONTO!' -ForegroundColor Green
Write-Host '  Página da Central neste servidor: http://localhost:3200'
Write-Host "  Comandos (ligar, desligar, status, logs): $gerenciar"
Write-Host '  Tudo liga sozinho quando o servidor reiniciar. Não precisa deixar ninguém logado.'
Write-Host ''
if (-not $Teste) { Read-Host 'Aperte Enter para fechar' }
