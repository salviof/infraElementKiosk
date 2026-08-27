#!/bin/bash
set -euo pipefail

# Define as variáveis
IMAGE_NAME="casanovadigital/elementkiosk"
CONTAINER_NAME="casanovakiosklab"
PORT_MAPPING="8099:80"
BUILD_CONTEXT="./buildKiosk"
ENV_FILE=".env"

echo "--- Iniciando a atualização do Kiosk ---"

# Passo 1: Parar o contêiner existente, se estiver rodando
echo "Parando o contêiner '$CONTAINER_NAME'..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
# O '|| true' impede que o script pare com um erro se o contêiner não existir.

# Passo 2: Remover o contêiner existente
echo "Removendo o contêiner '$CONTAINER_NAME'..."
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# Passo 3: Construir a nova imagem (--pull traz correções da imagem base)
echo "Construindo a nova imagem '$IMAGE_NAME'..."
docker build --pull -t "$IMAGE_NAME" "$BUILD_CONTEXT"

# Passo 4: Rodar o novo contêiner com a imagem atualizada.
# Se existir um .env (veja MODELO_ENV.sh), ele sobrescreve o config.json.
ARGS_ENV=()
if [ -f "$ENV_FILE" ]; then
    echo "Usando variáveis de '$ENV_FILE'..."
    ARGS_ENV=(--env-file "$ENV_FILE")
fi

echo "Iniciando o novo contêiner '$CONTAINER_NAME'..."
docker run -d \
    "${ARGS_ENV[@]}" \
    -p "$PORT_MAPPING" \
    --restart unless-stopped \
    --name "$CONTAINER_NAME" \
    "$IMAGE_NAME"

echo "--- Atualização do Kiosk concluída ---"

# Exibir status dos contêineres para verificação
docker ps | grep "$CONTAINER_NAME"

PORTA_HOST="${PORT_MAPPING%%:*}"
cat <<FIM

Testes rápidos:
  Modo kiosk:  http://localhost:${PORTA_HOST}/?salaConversa=%23chamadocliente110_ct%3Acasanovadigital.com.br&modo=kiosk&sso=Casanova
  Modo normal: http://localhost:${PORTA_HOST}/?modo=normal

No console do navegador: kioskCND.diagnostico()
FIM
