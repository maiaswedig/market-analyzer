# MARKET ANALYZER - servidor local minimo (nao precisa de Python nem admin)
# Serve os arquivos da propria pasta em http://localhost:PORTA/
param(
  [int]$Porta = 8777
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".ico"  = "image/x-icon"
  ".woff2"= "font/woff2"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
}

try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Porta)
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "Nao foi possivel abrir a porta $Porta. Feche outras janelas do MARKET ANALYZER e tente de novo." -ForegroundColor Red
  Read-Host "Pressione ENTER para sair"
  exit 1
}

Write-Host ""
Write-Host "MARKET ANALYZER rodando em http://localhost:$Porta/" -ForegroundColor Green
Write-Host "Deixe esta janela aberta. Para encerrar, feche a janela ou pressione Ctrl+C."
Write-Host ""

Start-Process "http://localhost:$Porta/index.html"

while ($true) {
  $cliente = $listener.AcceptTcpClient()
  try {
    $stream = $cliente.GetStream()
    $stream.ReadTimeout = 5000
    $buffer = New-Object byte[] 8192
    $lidos = $stream.Read($buffer, 0, $buffer.Length)
    if ($lidos -le 0) { $cliente.Close(); continue }
    $pedido = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $lidos)
    $primeira = ($pedido -split "`r?`n")[0]
    $partes = $primeira -split " "
    $caminho = if ($partes.Length -ge 2) { $partes[1] } else { "/" }
    $caminho = ($caminho -split "\?")[0]
    if ($caminho -eq "/" -or $caminho -eq "") { $caminho = "/index.html" }
    $caminho = [System.Uri]::UnescapeDataString($caminho)
    $relativo = $caminho.TrimStart("/").Replace("/", "\")

    $arquivo = Join-Path $raiz $relativo
    $arquivoCheio = $null
    try { $arquivoCheio = [System.IO.Path]::GetFullPath($arquivo) } catch { }

    if ($arquivoCheio -and $arquivoCheio.StartsWith($raiz) -and (Test-Path $arquivoCheio -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($arquivoCheio)
      $ext = [System.IO.Path]::GetExtension($arquivoCheio).ToLower()
      $tipo = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $cabecalho = "HTTP/1.1 200 OK`r`nContent-Type: $tipo`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 - arquivo nao encontrado")
      $cabecalho = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    }

    $bytesCabecalho = [System.Text.Encoding]::ASCII.GetBytes($cabecalho)
    $stream.Write($bytesCabecalho, 0, $bytesCabecalho.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch {
  } finally {
    $cliente.Close()
  }
}
