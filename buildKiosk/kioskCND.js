window.kioskCND = (function() {
    // Constantes para seletores e estados
    const SELECTORS = {
        SSO_BUTTON: '.mx_SSOButton', // Genérico, com verificação de texto
        GUEST_SIGNIN_BUTTON: '.mx_WelcomePage_guest .mx_ButtonSignIn',
        ROOM_VIEW: '.mx_RoomView',
        MATRIX_CHAT: '.mx_MatrixChat',
        MOBILE_GUIDE_BUTTON: '#back_to_element_button',
        USER_MENU: '.mx_UserMenu',
        ROOM_LIST: '.mx_RoomList'
    };

    const STATES = {
        HAS_CLICKED_SSO: false,
        HAS_CLICKED_GUEST: false,
        HAS_ENTERED_ROOM: false,
        HAS_HANDLED_MOBILE_GUIDE: false
    };

    let ssoPollTimeout;
    let ssoPollAttempts = 0;
    const MAX_POLL_ATTEMPTS = 30;
    const INITIAL_POLL_INTERVAL = 250; // ms
    const MAX_POLL_INTERVAL = 1000; // ms

    // Função para verificar se o usuário já está logado
    function isUserLoggedIn() {
        const chatContainer = document.querySelector(SELECTORS.MATRIX_CHAT) || document.querySelector(SELECTORS.ROOM_LIST) || document.querySelector(SELECTORS.USER_MENU);
        if (chatContainer) {
            console.log('kioskCND: Usuário detectado como logado via DOM.');
            return true;
        }
        const accessToken = localStorage.getItem('mx_access_token') || localStorage.getItem('mx_ls_matrix.casanovadigital.com.br_access_token');
        if (accessToken) {
            console.log('kioskCND: Usuário detectado como logado via token no localStorage.');
            return true;
        }
        console.log('kioskCND: Usuário não está logado.');
        return false;
    }

    // Função para desativar todos os monitores
    function disableAllMonitors() {
        console.log('kioskCND: Desativando todos os monitores.');
        if (ssoPollTimeout) clearTimeout(ssoPollTimeout);
    }

    // Função para lidar com a página Mobile Guide
    function handleMobileGuide() {
        if (STATES.HAS_HANDLED_MOBILE_GUIDE) {
            console.log('kioskCND: Mobile Guide já processado, ignorando.');
            return false;
        }

        if (document.title !== 'Element Mobile Guide' && !document.querySelector(SELECTORS.MOBILE_GUIDE_BUTTON)) {
            console.log('kioskCND: Não é a página Mobile Guide.');
            return false;
        }

        const desktopBtn = document.querySelector(SELECTORS.MOBILE_GUIDE_BUTTON);
        if (desktopBtn) {
            console.log('kioskCND: Detectada página Mobile Guide. Clicando em "Go to Desktop Site"...');
            desktopBtn.click();
            STATES.HAS_HANDLED_MOBILE_GUIDE = true;
            return true;
        }
        console.log('kioskCND: Botão "Go to Desktop Site" não encontrado na Mobile Guide.');
        return false;
    }

    // Função para clicar no botão SSO
    function tryClickSSO() {
        if (STATES.HAS_CLICKED_SSO) {
            console.log('kioskCND: SSO já clicado, ignorando.');
            return false;
        }

        const allSSOButtons = document.querySelectorAll(SELECTORS.SSO_BUTTON);
        console.log('kioskCND: Botões SSO encontrados:', allSSOButtons.length);

        if (allSSOButtons.length === 0) {
            console.log('kioskCND: Nenhum botão SSO encontrado no DOM.');
            return false;
        }

        allSSOButtons.forEach((btn, index) => {
            const dataAttrs = {};
            for (let attr of btn.attributes) {
                if (attr.name.startsWith('data-')) {
                    dataAttrs[attr.name] = attr.value;
                }
            }
            console.log(`kioskCND: Botão SSO #${index + 1} - Classes: ${btn.className}, Texto: "${btn.innerText.trim()}", Atributos data-*:`, dataAttrs);
        });

        let ssoBtn = Array.from(allSSOButtons).find(btn =>
            btn.innerText.toLowerCase().includes('casanova digital')
        ) || allSSOButtons[0];

        if (ssoBtn) {
            console.log('kioskCND: Botão SSO selecionado - Texto: "' + ssoBtn.innerText.trim() + '", clicando...');
            ssoBtn.click();
            STATES.HAS_CLICKED_SSO = true;
            return true;
        }

        console.log('kioskCND: Nenhum botão SSO válido encontrado.');
        return false;
    }

    // Função para clicar no botão SignIn da tela de convidado
    function tryClickGuestSignIn() {
        if (STATES.HAS_CLICKED_GUEST) {
            console.log('kioskCND: Guest SignIn já clicado, ignorando.');
            return false;
        }
        const guestBtn = document.querySelector(SELECTORS.GUEST_SIGNIN_BUTTON);
        if (guestBtn) {
            console.log('kioskCND: Botão Guest SignIn encontrado, clicando...');
            guestBtn.click();
            STATES.HAS_CLICKED_GUEST = true;
            return true;
        }
        console.log('kioskCND: Botão Guest SignIn não encontrado.');
        return false;
    }

    // Função para entrar na sala
    function tryEnterRoom() {
        const sala = localStorage.getItem('kioskSalaConversa');
        if (!sala || STATES.HAS_ENTERED_ROOM) {
            console.log('kioskCND: Sala não definida ou já entrou, ignorando.');
            return false;
        }

        const chatReady = document.querySelector(SELECTORS.MATRIX_CHAT) || document.body.classList.contains('mx_MatrixChat');
        if (!chatReady) {
            console.log('kioskCND: Chat principal não está pronto ainda. Aguardando...');
            return false;
        }

        const targetHash = '#/room/' + encodeURIComponent(sala);
        const currentHash = window.location.hash;

        if (currentHash !== targetHash) {
            console.log('kioskCND: Navegando para sala: ' + sala + ' (hash: ' + targetHash + ')');
            window.location.hash = targetHash;
            STATES.HAS_ENTERED_ROOM = true;
            return true;
        }
        console.log('kioskCND: Já está na sala ou hash já definido.');
        STATES.HAS_ENTERED_ROOM = true;
        return true;
    }

    // Função para polling com setTimeout
    function pollActions() {
        ssoPollAttempts++;
        const interval = Math.min(INITIAL_POLL_INTERVAL + ssoPollAttempts * 50, MAX_POLL_INTERVAL);

        if (isUserLoggedIn() && !STATES.HAS_ENTERED_ROOM) {
            console.log('kioskCND: Usuário logado detectado no polling. Desativando monitores e navegando para sala.');
            disableAllMonitors();
            tryEnterRoom();
            return;
        }

        let hasChanges = false;
        if (!STATES.HAS_HANDLED_MOBILE_GUIDE) {
            hasChanges = handleMobileGuide() || hasChanges;
        }
        if (!STATES.HAS_CLICKED_SSO) {
            hasChanges = tryClickSSO() || hasChanges;
        }
        if (!STATES.HAS_CLICKED_GUEST) {
            hasChanges = tryClickGuestSignIn() || hasChanges;
        }
        if (!STATES.HAS_ENTERED_ROOM) {
            hasChanges = tryEnterRoom() || hasChanges;
        }

        if (STATES.HAS_CLICKED_SSO && STATES.HAS_CLICKED_GUEST && STATES.HAS_ENTERED_ROOM && STATES.HAS_HANDLED_MOBILE_GUIDE) {
            console.log('kioskCND: Todas as ações completadas. Parando polling.');
            disableAllMonitors();
            return;
        }

        if (ssoPollAttempts < MAX_POLL_ATTEMPTS) {
            console.log('kioskCND: Continuando polling... Tentativa', ssoPollAttempts, 'Intervalo:', interval + 'ms');
            ssoPollTimeout = setTimeout(pollActions, interval);
        } else {
            console.warn('kioskCND: Limite de tentativas de polling atingido.');
            disableAllMonitors();
        }
    }

    // Função para inicializar
    function kioskInicializar() {
        const params = new URLSearchParams(window.location.search);
        const salaParam = params.get('salaConversa');
        if (salaParam) {
            localStorage.setItem('kioskSalaConversa', salaParam);
        }

        if (isUserLoggedIn()) {
            console.log('kioskCND: Usuário já logado na inicialização. Navegando diretamente para a sala.');
            disableAllMonitors();
            tryEnterRoom();
            return;
        }

        handleMobileGuide();
        tryClickSSO();
        tryClickGuestSignIn();
        tryEnterRoom();

        if (!(STATES.HAS_CLICKED_SSO && STATES.HAS_CLICKED_GUEST && STATES.HAS_ENTERED_ROOM && STATES.HAS_HANDLED_MOBILE_GUIDE)) {
            console.log('kioskCND: Iniciando polling com intervalo inicial de', INITIAL_POLL_INTERVAL + 'ms');
            ssoPollTimeout = setTimeout(pollActions, INITIAL_POLL_INTERVAL);
        }
    }

    // Resetar estados
    function reset() {
        Object.keys(STATES).forEach(key => STATES[key] = false);
        disableAllMonitors();
        kioskInicializar();
    }

    // Chamar inicialização
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', kioskInicializar);
    } else {
        kioskInicializar();
    }

    // Funções públicas
    return {
        tryClickSSO,
        tryClickGuestSignIn,
        tryEnterRoom,
        handleMobileGuide,
        isUserLoggedIn,
        disableAllMonitors,
        reset
    };
})();
