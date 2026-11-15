#!/bin/bash
#
# ABRIR SITE: inicia o servidor local e abre o site no navegador.
#
# Este e o unico arquivo que voce precisa executar. Ele encontra o Python,
# sobe o servidor na primeira porta livre e abre a pagina sozinho.
#
# NA PRIMEIRA VEZ o macOS bloqueia este arquivo. Sao duas travas somadas:
#
#   1. o navegador grava sem permissao de execucao (e nao tem como conceder);
#   2. o macOS marca com "quarentena" tudo que veio da internet, e o Gatekeeper
#      recusa executar script sem assinatura. O aviso "A Apple nao pode
#      verificar se este item esta livre de malware" vem dai.
#
# Contorne uma vez pelo Terminal, onde nenhuma das duas se aplica:
#
#     1. abra o Terminal
#     2. digite  bash  e um espaco
#     3. arraste ESTE arquivo para dentro da janela
#     4. Enter
#
# As linhas abaixo desfazem as duas travas, e a partir dai o duplo clique
# funciona normalmente.

cd "$(dirname "$0")" || exit 1

chmod 755 "$0" 2>/dev/null
xattr -d com.apple.quarantine "$0" 2>/dev/null
xattr -d com.apple.quarantine "__offline/servidor.py" 2>/dev/null

MOTOR="__offline/servidor.py"

if [ ! -f "$MOTOR" ]; then
  echo
  echo "  Nao encontrei $MOTOR."
  echo "  Execute este atalho de dentro da pasta que a extensao gerou."
  echo
  read -r -p "  Pressione Enter para fechar."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo
  echo "  Python 3 nao encontrado."
  echo
  echo "  No macOS, instale as ferramentas de linha de comando com:"
  echo "      xcode-select --install"
  echo "  Ou baixe o Python em https://www.python.org/downloads/"
  echo
  read -r -p "  Pressione Enter para fechar."
  exit 1
fi

"$PY" "$MOTOR" "$@"

echo
read -r -p "  Servidor encerrado. Pressione Enter para fechar."
