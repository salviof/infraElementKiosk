# Usar a imagem base do Element Web
FROM vectorim/element-web:v1.11.70

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de customização
COPY kioskCND.js kioskCND.css entrypoint.sh config.json ./

# Garantir que o script entrypoint seja executável
RUN chmod +x /app/entrypoint.sh

# Copiar arquivos para o diretório que o Nginx/Element serve
COPY kioskCND.js /usr/share/nginx/html/kioskCND.js
COPY kioskCND.css /usr/share/nginx/html/kioskCND.css
COPY config.json /usr/share/nginx/html/config.json

# Expor porta do Nginx
EXPOSE 80

# Usar o entrypoint script
ENTRYPOINT ["sh", "/app/entrypoint.sh"]