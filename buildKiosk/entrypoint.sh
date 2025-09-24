 
# Copiar arquivos customizados para o diretório de assets do Element
#cp /app/kioskCND.js /usr/share/nginx/html/kioskCND.js
#cp /app/kioskCND.css /usr/share/nginx/html/kioskCND.css
#set -e
#
## 1. Gerar config.json dinâmico
#cat > /app/config.json <<EOF
#{
#  "default_server_config": {
#    "m.homeserver": {
#      "base_url": "${HOMESERVER_URL}",
#      "server_name": "${SERVER_NAME}"
#    }
#  },
#  "brand": "${BRAND}",
#  "sso_url": "${SSO_URL}",
#  "welcome_title": "${WELCOME_TITLE}",
#  "welcome_body": "${WELCOME_BODY}",
#  "default_theme": "${DEFAULT_THEME:-light}"
#}
#EOF


# Modificar o index.html para incluir o custom.js
sed -i '/<\/head>/i <script src="/kioskCND.js"></script>' /usr/share/nginx/html/index.html
sed -i '/<\/head>/i <script src="/kioskCND.js"></script>' /usr/share/nginx/html/mobile_guide/index.html
sed -i '/<\/head>/i <link rel="stylesheet" href="/kioskCND.css">' /usr/share/nginx/html/index.html
# Copiar config.json para o diretório de assets (obrigatório para o Element ler)
cp /app/config.json /usr/share/nginx/html/config.json
# Iniciar o Nginx
nginx -g 'daemon off;'

