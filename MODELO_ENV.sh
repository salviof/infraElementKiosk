# Modelo do .env do Element Kiosk - copie para .env na raiz do projeto.
# Atencao: o docker --env-file NAO interpreta aspas; escreva os valores crus.

# URL do homeserver Matrix
KIOSK_CND_HOME_SERVER_URL=https://meuservidormatrix.com.br
# Dominio Matrix (server_name), nao um nome descritivo
KIOSK_CND_HOME_SERVER_NAME=meuservidor.com.br
# Logo da tela de login (vazio = mantem o do config.json)
KIOSK_CND_BRAND_IMG_URL=
# Nome exibido do servico
KIOSK_CND_BRAND_NAME=
# light | dark
KIOSK_CND_TEMA=light
