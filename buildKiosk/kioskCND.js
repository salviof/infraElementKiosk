window.kioskCND = (function() {

    /**
     * Seletores utilizados para buscar elementos no DOM.
     */
    const SELECTORS = {
        SSO_BUTTON: '.mx_SSOButton', // Genérico, com verificação de texto
        GUEST_SIGNIN_BUTTON: '.mx_WelcomePage_guest .mx_ButtonSignIn',
        ROOM_VIEW: '.mx_RoomView',
        MATRIX_CHAT: '.mx_MatrixChat',
        MOBILE_GUIDE_BUTTON: '#back_to_element_button',
        VERIFY_MODAL_SKIP_BUTTON: '.mx_CompleteSecurity_skip',
        VERIFY_LATER_BUTTON_TEXT: ".mx_AccessibleButton_kind_danger_outline",
        USER_MENU: '.mx_UserMenu',
        ROOM_LIST: '.mx_RoomList'
    };
    /**
     * Estados internos do script.
     */
    const STATES = {
        HAS_CLICKED_SSO: false,
        HAS_CLICKED_GUEST: false,
        HAS_ENTERED_ROOM: false,
        HAS_HANDLED_MOBILE_GUIDE: false
    };

    let ssoPollTimeout;
    let ssoPollAttempts = 0;
    /** Máximo de tentativas de polling. */
    const MAX_POLL_ATTEMPTS = 30;
    /** Intervalo inicial do polling em ms. */
    const INITIAL_POLL_INTERVAL = 250;
    /** Intervalo máximo do polling em ms. */
    const MAX_POLL_INTERVAL = 1000;

    /**
     * Verifica se o usuário já está logado.
     * @returns {boolean} true se o usuário estiver logado, false caso contrário.
     */
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
        console.log('kioskCND: Usuário não está logadooaihwuifhauwhfaw.');
        return false;
    }

    /**
     * Desativa todos os monitores/observers ativos.
     */
    function disableAllMonitors() {
        console.log('kioskCND: Desativando todos os monitores.');
        if (ssoPollTimeout) clearTimeout(ssoPollTimeout);
    }

    /**
     * Observa a página Mobile Guide e clica no botão de voltar para o modo Desktop.
     */
    function setupMobileGuideObserver() {
        if (!window.location.pathname.includes("/mobile_guide")) {
            return;
        }

        console.log("kioskCND: Detectada página Mobile Guide. Iniciando observador de botão...");

        const observer = new MutationObserver((mutationsList, observer) => {
            const desktopBtn = document.querySelector(SELECTORS.MOBILE_GUIDE_BUTTON);
            if (desktopBtn) {
                console.log('kioskCND: Botão "Go to Desktop Site" detectado pelo observador. Clicando...');
                desktopBtn.click();
                // O trabalho está feito, desconecta o observador para economizar recursos.
                observer.disconnect();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Observa modais de verificação de segurança e fecha automaticamente.
     */
    function setupVerificationModalObserver() {
        console.log("kioskCND: Observador de modal de verificação INICIADO.");

        const observer = new MutationObserver((mutationsList, observer) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    const skipBtn = document.querySelector(SELECTORS.VERIFY_MODAL_SKIP_BUTTON);
                    if (skipBtn) {
                        console.log('kioskCND: Modal de segurança (tipo 1) detectado. Fechando...');
                        skipBtn.click();
                        // return; // Ação realizada
                    }
                    const verifyLaterBtn = document.querySelector(SELECTORS.VERIFY_LATER_BUTTON_TEXT);

                    if (verifyLaterBtn) {
                        console.log('kioskCND: Modal de segurança (tipo 2) detectado. Clicando em "Verify Later"...');
                        verifyLaterBtn.click();
                        return; // Ação realizada
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }


    /**
     * Clica automaticamente no botão de login via SSO.
     * @returns {boolean} true se clicou, false caso contrário.
     */
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

    /**
     * Clica automaticamente no botão "Sign In" do modo convidado.
     * @returns {boolean} true se clicou, false caso contrário.
     */
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
        // if (!STATES.HAS_HANDLED_MOBILE_GUIDE) {
        //     hasChanges = handleMobileGuide() || hasChanges;
        // }
        if (!STATES.HAS_CLICKED_SSO) {
            hasChanges = tryClickSSO() || hasChanges;
        }
        if (!STATES.HAS_CLICKED_GUEST) {
            hasChanges = tryClickGuestSignIn() || hasChanges;
        }
        if (!STATES.HAS_ENTERED_ROOM) {
            hasChanges = tryEnterRoom() || hasChanges;
        }

        if (ssoPollAttempts < MAX_POLL_ATTEMPTS) {
            ssoPollTimeout = setTimeout(pollActions, interval);
        } else {
            console.warn('kioskCND: Limite de tentativas de polling atingido.');
            disableAllMonitors();
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

    /**
     * Inicializa o script e define listeners principais.
     */
    function kioskInicializar() {

        const params = new URLSearchParams(window.location.search);
        const salaParam = params.get('salaConversa');
        if (salaParam) {
            localStorage.setItem('kioskSalaConversa', salaParam);
        }

        setupVerificationModalObserver();
        setupMobileGuideObserver();
        // setupMobileGuideObserver();

        if (isUserLoggedIn()) {
            console.log('kioskCND: Usuário já logado na inicialização. Navegando diretamente para a sala.');
            disableAllMonitors();
            tryEnterRoom();
            return;
        }
        // handleMobileGuide();
        tryClickSSO();
        tryClickGuestSignIn();
        tryEnterRoom();


        if (!(STATES.HAS_CLICKED_SSO && STATES.HAS_CLICKED_GUEST && STATES.HAS_ENTERED_ROOM && STATES.HAS_HANDLED_MOBILE_GUIDE)) {
            console.log('kioskCND: Iniciando polling com intervalo inicial de', INITIAL_POLL_INTERVAL + 'ms');
            ssoPollTimeout = setTimeout(pollActions, INITIAL_POLL_INTERVAL);
        }
    }

    /**
     * Reseta os estados e reinicializa o script.
     */
    function reset() {
        Object.keys(STATES).forEach(key => STATES[key] = false);
        disableAllMonitors();
        kioskInicializar();
    }

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
        // handleMobileGuide,
        isUserLoggedIn,
        disableAllMonitors,
        reset
    };
})();
