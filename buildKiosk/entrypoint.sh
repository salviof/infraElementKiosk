#!/bin/sh
#
# Instalado como /docker-entrypoint.d/19-kiosk-cnd.sh (veja o Dockerfile).
#
# Roda dentro do entrypoint oficial do nginx, depois do script 18 da imagem do
# Element - que copia /app/config*.json para /tmp/element-web-config, de onde o
# config.json e realmente servido.
#
# A injecao do kioskCND.js/kioskCND.css acontece no build, porque /app e
# somente leitura para o usuario nginx. Aqui apenas aplicamos, quando
# informadas, variaveis de ambiente sobre o config.json servido. Todas sao
# opcionais - sem nenhuma delas vale o config.json do build.
#
#   KIOSK_CND_HOME_SERVER_URL   ex.: https://matrix.exemplo.com.br
#   KIOSK_CND_HOME_SERVER_NAME  dominio matrix, ex.: exemplo.com.br
#   KIOSK_CND_BRAND_NAME        nome exibido do servico
#   KIOSK_CND_BRAND_IMG_URL     logo da tela de login
#   KIOSK_CND_TEMA              light | dark
#
# Este script nunca deve falhar: o entrypoint do nginx roda com "set -e" e
# abortaria a subida do container.

CONFIG="/tmp/element-web-config/config.json"

registrar() {
    echo "kioskCND: $*"
}

if [ ! -f "$CONFIG" ]; then
    registrar "aviso: $CONFIG nao existe; nenhum ajuste aplicado"
    exit 0
fi

if ! command -v jq > /dev/null 2>&1; then
    registrar "aviso: jq indisponivel; variaveis de ambiente ignoradas"
    exit 0
fi

# aplicar <caminho jq> <valor>
aplicar() {
    caminho="$1"
    valor="$2"
    [ -z "$valor" ] && return 0
    if jq --arg v "$valor" "$caminho = \$v" "$CONFIG" > "$CONFIG.novo" 2> /dev/null; then
        mv "$CONFIG.novo" "$CONFIG"
        registrar "config.json: $caminho = $valor"
    else
        rm -f "$CONFIG.novo"
        registrar "aviso: falha ao aplicar $caminho"
    fi
}

aplicar '.default_server_config["m.homeserver"].base_url' "$KIOSK_CND_HOME_SERVER_URL"
aplicar '.default_server_config["m.homeserver"].server_name' "$KIOSK_CND_HOME_SERVER_NAME"
aplicar '.brand' "$KIOSK_CND_BRAND_NAME"
aplicar '.branding.auth_header_logo_url' "$KIOSK_CND_BRAND_IMG_URL"
aplicar '.default_theme' "$KIOSK_CND_TEMA"

registrar "customizacao pronta"
exit 0
