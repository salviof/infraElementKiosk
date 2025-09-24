#!/bin/bash

# Define as variáveis
IMAGE_NAME="casanovadigital/elementkiosk"
CONTAINER_NAME="casanovakiosklab"
PORT_MAPPING="8099:80"
BUILD_CONTEXT="./buildKiosk"




echo "--- Iniciando a atualização do Kiosk ---"
# Passo 1: Parar o contêiner existente, se estiver rodando
echo "Parando o contêiner '$CONTAINER_NAME'..."
docker stop $CONTAINER_NAME 2>/dev/null || true
# O '|| true' impede que o script pare com um erro se o contêiner não existir.

# Passo 2: Remover o contêiner existente
echo "Removendo o contêiner '$CONTAINER_NAME'..."
docker rm $CONTAINER_NAME 2>/dev/null || true

# Passo 3: Construir a nova imagem
echo "Construindo a nova imagem '$IMAGE_NAME'..."
docker build -t $IMAGE_NAME $BUILD_CONTEXT

# Passo 4: Rodar o novo contêiner com a imagem atualizada
echo "Iniciando o novo contêiner '$CONTAINER_NAME'..."
docker run -d -p $PORT_MAPPING --name $CONTAINER_NAME $IMAGE_NAME

echo "--- Atualização do Kiosk concluída ---"

# Exibir status dos contêineres para verificação
docker ps | grep $CONTAINER_NAME
