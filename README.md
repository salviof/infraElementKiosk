# ElementKiosk

Automação para o **Element Web** em modo Kiosk.  
Este script auxilia na interação automática com a interface do Element, evitando que o usuário precise realizar ações manuais de login ou navegação.

---

## 📌 Funcionalidades

- Detecta se o usuário já está logado (via DOM ou `localStorage`).
- Clica automaticamente no botão **SSO** ou no **Guest Sign In**.
- Redireciona automaticamente para a sala definida na URL.
- Fecha automaticamente os modais de verificação de segurança.
- Converte a tela **Mobile Guide** para a versão **Desktop**.
- Executa polling até que todas as ações estejam concluídas.

---
📝 Observações

Desenvolvido para ambientes controlados de kiosk.

Pode ser ajustado de acordo com as particularidades do Element Web usado.

Testado em navegadores baseados em Chromium.