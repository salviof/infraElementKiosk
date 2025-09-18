 
# Copiar arquivos customizados para o diretório de assets do Element
#cp /app/kioskCND.js /usr/share/nginx/html/kioskCND.js
#cp /app/kioskCND.css /usr/share/nginx/html/kioskCND.css

# Modificar o index.html para incluir o custom.js
sed -i '/<\/head>/i <script src="/kioskCND.js"></script>' /usr/share/nginx/html/index.html
sed -i '/<\/head>/i <link rel="stylesheet" href="/kioskCND.css">' /usr/share/nginx/html/index.html
# Copiar config.json para o diretório de assets (obrigatório para o Element ler)
cp /app/config.json /usr/share/nginx/html/config.json
# Iniciar o Nginx
nginx -g 'daemon off;'

