# Element Web em modo kiosk - base na ultima versao estavel do element-web.
FROM vectorim/element-web:v1.12.26

# A imagem oficial roda como usuario "nginx" e serve /app
# (/usr/share/nginx/html e um link para /app). Por isso toda a customizacao e
# feita aqui, no build: em execucao o processo nao pode escrever em /app.
USER root

# Arquivos servidos na raiz do site.
COPY kioskCND.js kioskCND.css navegacaoKiosk.json config.json /app/

# Hook do entrypoint oficial do nginx: ele executa /docker-entrypoint.d/*.sh em
# ordem alfabetica. O 18 da imagem do Element copia /app/config*.json para
# /tmp/element-web-config, entao o nosso precisa rodar depois: 19.
COPY entrypoint.sh /docker-entrypoint.d/19-kiosk-cnd.sh

RUN set -eux; \
    # 1. Falhar o build (e nao o kiosk em producao) se algum JSON estiver quebrado.
    jq -e . /app/navegacaoKiosk.json > /dev/null; \
    jq -e . /app/config.json > /dev/null; \
    \
    # 2. Injetar o CSS e o JS no <head> das paginas do Element. O index.html tem
    #    CSP "script-src 'self'", por isso os arquivos sao externos (nada inline).
    for pagina in /app/index.html /app/mobile_guide/index.html; do \
        sed -i 's#</head>#<link rel="stylesheet" href="/kioskCND.css"><script src="/kioskCND.js"></script></head>#' "$pagina"; \
        grep -q '/kioskCND.js' "$pagina"; \
    done; \
    \
    # 3. Nao cachear os arquivos da customizacao: editar navegacaoKiosk.json e
    #    recriar o container deve valer no proximo F5 do terminal de atendimento.
    printf '%s\n' \
        '' \
        '    # kioskCND: customizacao sempre revalidada pelo navegador.' \
        '    location ~ ^/(kioskCND\.(js|css)|navegacaoKiosk\.json)$ {' \
        '        add_header Cache-Control "no-cache";' \
        '    }' \
        > /tmp/kiosk-nocache.conf; \
    sed -i '/^    index  index.html;$/r /tmp/kiosk-nocache.conf' /etc/nginx/templates/default.conf.template; \
    rm -f /tmp/kiosk-nocache.conf; \
    grep -q kioskCND /etc/nginx/templates/default.conf.template; \
    \
    # 4. Permissoes.
    chmod 0644 /app/kioskCND.js /app/kioskCND.css /app/navegacaoKiosk.json /app/config.json; \
    chmod 0755 /docker-entrypoint.d/19-kiosk-cnd.sh

USER nginx

# ENTRYPOINT e CMD sao os da imagem oficial (nginx + hooks em
# /docker-entrypoint.d). A porta vem de ELEMENT_WEB_PORT, que ja vale 80.
EXPOSE 80
