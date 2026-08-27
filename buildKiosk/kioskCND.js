/**
 * kioskCND - automacao de navegacao do Element Web em modo kiosk.
 *
 * Este arquivo e apenas o MOTOR: ele nao sabe nada sobre botoes, salas ou
 * provedores de SSO. Tudo isso vem de /navegacaoKiosk.json, que descreve
 * estados (como reconhecer em que tela o Element esta) e regras
 * (quando fazer o que). Para mudar o comportamento, edite o JSON.
 *
 * Parametros aceitos na URL (nomes configuraveis em parametrosUrl):
 *   ?salaConversa=%23sala_ct%3Aservidor  sala que deve ser aberta
 *   &modo=kiosk|normal                   com ou sem automacao/estilo kiosk
 *   &sso=Casanova                        provedor de SSO (casa com aria-label)
 *
 * API de depuracao no console: kioskCND.ajuda()
 */
window.kioskCND = (function () {
    "use strict";

    /** Configuracao servida pelo container (copiada em /app pelo Dockerfile). */
    const URL_CONFIG = "/navegacaoKiosk.json";

    /**
     * Configuracao minima embutida. Serve para dois momentos:
     *  1. antes do fetch do JSON, para aplicar a classe de modo no <html>
     *     ainda no <head> (evita o kiosk "piscar" a interface completa);
     *  2. como rede de seguranca se o JSON nao carregar - nesse caso nao
     *     existe nenhuma regra, ou seja, o Element funciona sem automacao.
     */
    const CONFIG_MINIMA = {
        versao: 1,
        parametrosUrl: { sala: "salaConversa", modo: "modo", sso: "sso" },
        padroes: { modo: "normal", sso: "", sala: "" },
        modosValidos: ["kiosk", "normal"],
        sessao: {
            armazenamento: "localStorage",
            chave: "kioskCND:intencao",
            validadeMs: 300000,
            somenteDuranteLogin: true,
            chaveConfigTemporaria: "kioskCND:configTemporaria",
            validadeConfigTemporariaMs: 86400000
        },
        log: { ativo: true, prefixo: "kioskCND", nivel: "info" },
        polling: {
            intervaloInicialMs: 250,
            intervaloMaximoMs: 3000,
            fatorBackoff: 1.4,
            duracaoMaximaMs: 0,
            observarMutacoes: true,
            debounceMutacaoMs: 120
        },
        interface: {
            classeBase: "kioskCND",
            classePorModo: { kiosk: "kioskCND--kiosk", normal: "kioskCND--normal" },
            aplicarCss: true,
            botaoAlternarModo: { ativo: false }
        },
        estados: {},
        regras: []
    };

    /** Chaves do localStorage do proprio Element usadas como pista de sessao. */
    const NIVEIS_LOG = { silencioso: 0, erro: 1, aviso: 2, info: 3, debug: 4 };

    let config = clonar(CONFIG_MINIMA);
    /** O que veio de navegacaoKiosk.json, para limparConfig() poder voltar. */
    let configDoArquivo = null;
    /** "minima" | "arquivo" | "temporaria" (injetada pelo console). */
    let origemConfig = "minima";
    /** Intencao resolvida da URL/sessao: { modo, sala, sso }. */
    let intencao = { modo: "kiosk", sala: "", sso: "" };
    /** Estado de execucao por regra: id -> { tentativas, concluida, ... }. */
    const execucoes = new Map();

    let temporizador = null;
    let temporizadorDebounce = null;
    let observador = null;
    let intervaloAtual = CONFIG_MINIMA.polling.intervaloInicialMs;
    let inicioMs = 0;
    let ativo = false;
    let configCarregada = false;

    /* ------------------------------------------------------------------ *
     * Utilitarios
     * ------------------------------------------------------------------ */

    function clonar(valor) {
        return JSON.parse(JSON.stringify(valor));
    }

    function ehObjeto(valor) {
        return !!valor && typeof valor === "object" && !Array.isArray(valor);
    }

    /** Mescla profunda: objetos sao combinados, listas e escalares substituidos. */
    function mesclar(base, novo) {
        if (!ehObjeto(base) || !ehObjeto(novo)) {
            return novo === undefined ? base : novo;
        }
        const saida = Object.assign({}, base);
        Object.keys(novo).forEach(function (chave) {
            saida[chave] = mesclar(base[chave], novo[chave]);
        });
        return saida;
    }

    function deveLogar(nivel) {
        const cfg = config.log || {};
        if (cfg.ativo === false) return false;
        const atual = NIVEIS_LOG[cfg.nivel] === undefined ? NIVEIS_LOG.info : NIVEIS_LOG[cfg.nivel];
        return atual >= NIVEIS_LOG[nivel];
    }

    function prefixo() {
        return ((config.log && config.log.prefixo) || "kioskCND") + ":";
    }

    function log() {
        if (!deveLogar("info")) return;
        console.log.apply(console, [prefixo()].concat(Array.prototype.slice.call(arguments)));
    }

    function depurar() {
        if (!deveLogar("debug")) return;
        console.debug.apply(console, [prefixo()].concat(Array.prototype.slice.call(arguments)));
    }

    function aviso() {
        if (!deveLogar("aviso")) return;
        console.warn.apply(console, [prefixo()].concat(Array.prototype.slice.call(arguments)));
    }

    function erro() {
        if (!deveLogar("erro")) return;
        console.error.apply(console, [prefixo()].concat(Array.prototype.slice.call(arguments)));
    }

    /** Minusculas, sem acentos e sem espacos duplicados - para comparar textos. */
    function normalizar(texto) {
        return String(texto === null || texto === undefined ? "" : texto)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function comoLista(valor) {
        if (valor === null || valor === undefined) return [];
        return Array.isArray(valor) ? valor : [valor];
    }

    function existeSeletor(seletor) {
        try {
            return !!document.querySelector(seletor);
        } catch (e) {
            aviso("seletor invalido: " + seletor, e);
            return false;
        }
    }

    /**
     * Nome acessivel do elemento, na ordem que os navegadores usam.
     *
     * E o unico jeito confiavel de identificar os botoes de SSO: quando ha
     * dois ou mais provedores, o Element usa botoes de icone e joga
     * "Continuar com <provedor>" em um <span> escondido apontado por
     * aria-labelledby - o aria-label do botao fica vazio.
     */
    function nomeAcessivel(elemento) {
        const rotulo = elemento.getAttribute("aria-label");
        if (rotulo && rotulo.trim()) return rotulo;

        const referencias = (elemento.getAttribute("aria-labelledby") || "").trim();
        if (referencias) {
            const textos = referencias.split(/\s+/).map(function (id) {
                const alvo = document.getElementById(id);
                return alvo ? alvo.textContent || "" : "";
            }).filter(Boolean);
            if (textos.length) return textos.join(" ");
        }

        const titulo = elemento.getAttribute("title");
        if (titulo && titulo.trim()) return titulo;

        return elemento.innerText || elemento.textContent || "";
    }

    function visivel(elemento) {
        if (!elemento) return false;
        if (elemento.getAttribute("aria-disabled") === "true" || elemento.disabled) return false;
        return elemento.offsetParent !== null || elemento.getClientRects().length > 0;
    }

    function agora() {
        return Date.now();
    }

    /* ------------------------------------------------------------------ *
     * Sessao (sobrevive ao redirecionamento do SSO)
     * ------------------------------------------------------------------ */

    function deposito() {
        const tipo = (config.sessao && config.sessao.armazenamento) || "localStorage";
        try {
            return window[tipo] || null;
        } catch (e) {
            return null; // navegador com armazenamento bloqueado
        }
    }

    function chaveSessao() {
        return (config.sessao && config.sessao.chave) || "kioskCND:intencao";
    }

    function lerSessao() {
        const armazem = deposito();
        if (!armazem) return null;
        try {
            const bruto = armazem.getItem(chaveSessao());
            if (!bruto) return null;
            const dados = JSON.parse(bruto);
            const validade = Number((config.sessao && config.sessao.validadeMs) || 0);
            if (validade > 0 && dados.gravadoEm && agora() - dados.gravadoEm > validade) {
                depurar("intencao guardada expirou, descartando");
                armazem.removeItem(chaveSessao());
                return null;
            }
            return dados;
        } catch (e) {
            return null;
        }
    }

    /** Grava mesclando com o que ja existe (preserva marcas como loginIniciado). */
    function gravarSessao(dados) {
        const armazem = deposito();
        if (!armazem) return;
        try {
            const atual = lerSessao() || {};
            const novo = Object.assign({}, atual, dados, { gravadoEm: agora() });
            armazem.setItem(chaveSessao(), JSON.stringify(novo));
        } catch (e) {
            aviso("nao foi possivel guardar a intencao de navegacao", e);
        }
    }

    function limparSessao() {
        const armazem = deposito();
        if (!armazem) return;
        try {
            armazem.removeItem(chaveSessao());
        } catch (e) {
            /* ignorado */
        }
    }

    /** Le uma chave sempre do localStorage - e la que o Element guarda credenciais. */
    function temChaveLocal(chave) {
        try {
            return !!(window.localStorage && window.localStorage.getItem(chave));
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ *
     * Intencao: modo + sala + provedor de SSO
     * ------------------------------------------------------------------ */

    function nomeParametro(qual) {
        const nomes = config.parametrosUrl || {};
        return nomes[qual] || CONFIG_MINIMA.parametrosUrl[qual];
    }

    function lerParametrosUrl() {
        const busca = new URLSearchParams(window.location.search);
        return {
            sala: busca.get(nomeParametro("sala")),
            modo: busca.get(nomeParametro("modo")),
            sso: busca.get(nomeParametro("sso"))
        };
    }

    /**
     * Normaliza o identificador da sala.
     *
     * O Element le o trecho depois de "#/room/" CRU, sem decodificar. Ou seja,
     * "#/room/%23sala%3Aservidor" nao funciona: tem que ser
     * "#/room/#sala:servidor". Como URLSearchParams ja decodifica o valor do
     * parametro, aqui so tratamos sobras de codificacao e o "#" ausente.
     */
    function normalizarSala(valor) {
        let sala = String(valor || "").trim();
        if (!sala) return "";
        if (/^%(23|21)/i.test(sala)) {
            try {
                sala = decodeURIComponent(sala);
            } catch (e) {
                /* mantem como veio */
            }
        }
        if (sala.charAt(0) !== "#" && sala.charAt(0) !== "!" && sala.indexOf(":") > 0) {
            sala = "#" + sala; // apelido informado sem o "#"
        }
        return sala;
    }

    /** Estamos no meio de um login por SSO (ida ou volta do provedor)? */
    function loginEmAndamento(daSessao) {
        if (daSessao && daSessao.loginIniciado) return true;
        return window.location.search.indexOf("loginToken") !== -1;
    }

    function resolverIntencao() {
        const daUrl = lerParametrosUrl();
        const daSessao = lerSessao() || {};
        const padroes = config.padroes || {};
        const validos = config.modosValidos || CONFIG_MINIMA.modosValidos;
        const modoPadrao = padroes.modo || CONFIG_MINIMA.padroes.modo;

        // O modo so e herdado da sessao durante um login por SSO - alguns
        // provedores descartam a query string na volta. Fora disso vale o que
        // esta na URL e, sem parametro, o padrao (Element normal).
        const herdaModo =
            (config.sessao || {}).somenteDuranteLogin === false || loginEmAndamento(daSessao);
        const modoDaSessao = herdaModo ? daSessao.modo : "";

        let modo = normalizar(daUrl.modo || modoDaSessao || modoPadrao);
        if (validos.indexOf(modo) === -1) {
            aviso('modo "' + modo + '" desconhecido; usando "' + modoPadrao + '"');
            modo = modoPadrao;
        }

        const resolvida = {
            modo: modo,
            sala: normalizarSala(daUrl.sala || daSessao.sala || padroes.sala || ""),
            sso: String(daUrl.sso || daSessao.sso || padroes.sso || "").trim(),
            origem: {
                modo: daUrl.modo ? "url" : modoDaSessao ? "sessao" : "padrao",
                sala: daUrl.sala ? "url" : daSessao.sala ? "sessao" : "padrao",
                sso: daUrl.sso ? "url" : daSessao.sso ? "sessao" : "padrao"
            }
        };

        // Guardar a intencao e o que sustenta o modo kiosk atravessando o
        // redirecionamento do SSO, caso o provedor descarte a query string.
        gravarSessao({
            modo: resolvida.modo,
            sala: resolvida.sala,
            sso: resolvida.sso
        });

        return resolvida;
    }

    function interpolar(texto) {
        return String(texto === null || texto === undefined ? "" : texto)
            .replace(/\{\{\s*sala\s*\}\}/g, intencao.sala)
            .replace(/\{\{\s*sso\s*\}\}/g, intencao.sso)
            .replace(/\{\{\s*modo\s*\}\}/g, intencao.modo);
    }

    /* ------------------------------------------------------------------ *
     * Aparencia: classes de modo e botao de alternancia
     * ------------------------------------------------------------------ */

    /**
     * O kioskCND.css e todo escopado nas classes de modo aplicadas aqui.
     * Com interface.aplicarCss = false nenhuma classe de modo entra no <html>,
     * ou seja, o CSS do kiosk deixa de valer sem parar a automacao.
     */
    function aplicarClassesDeModo() {
        const iface = config.interface || {};
        const raiz = document.documentElement;
        if (!raiz) return;
        if (iface.classeBase) raiz.classList.add(iface.classeBase);

        const mapa = iface.classePorModo || {};
        const cssLigado = iface.aplicarCss !== false;
        Object.keys(mapa).forEach(function (modo) {
            if (!mapa[modo]) return;
            if (cssLigado && modo === intencao.modo) raiz.classList.add(mapa[modo]);
            else raiz.classList.remove(mapa[modo]);
        });

        raiz.setAttribute("data-kiosk-cnd-modo", intencao.modo);
    }

    /**
     * Troca de modo: recarrega a mesma tela com ?modo=<destino>, preservando
     * a sala e o hash atual. E o caminho "entrar normalmente, sem o kiosk".
     */
    function alternarModo(destino) {
        const validos = config.modosValidos || CONFIG_MINIMA.modosValidos;
        if (validos.indexOf(destino) === -1) {
            erro('alternarModo: modo invalido "' + destino + '"');
            return;
        }
        limparSessao();
        const url = new URL(window.location.href);
        url.searchParams.set(nomeParametro("modo"), destino);
        url.searchParams.delete("loginToken");
        log("alternando para o modo " + destino + " -> " + url.toString());
        window.location.href = url.toString();
    }

    function montarBotaoAlternarModo() {
        const cfg = (config.interface || {}).botaoAlternarModo || {};
        const classe = cfg.classe || "kioskCND_botaoModo";
        const anterior = document.querySelector("." + classe);
        if (anterior) anterior.remove();
        if (!cfg.ativo || !document.body) return;

        const def = (cfg.porModo || {})[intencao.modo];
        if (!def || !def.modoDestino) return;

        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = classe;
        botao.textContent = def.texto || "Alternar modo";
        if (def.titulo) botao.title = def.titulo;
        botao.setAttribute("data-kiosk-cnd-destino", def.modoDestino);
        botao.addEventListener("click", function (evento) {
            evento.preventDefault();
            alternarModo(def.modoDestino);
        });
        document.body.appendChild(botao);
        depurar("botao de alternancia de modo publicado");
    }

    /* ------------------------------------------------------------------ *
     * Estados declarados no JSON
     * ------------------------------------------------------------------ */

    function avaliarEstado(nome) {
        const def = (config.estados || {})[nome];
        if (!def) {
            aviso('estado "' + nome + '" nao esta declarado em navegacaoKiosk.json');
            return false;
        }

        const seletoresQualquer = comoLista(def.qualquerSeletor);
        const chavesQualquer = comoLista(def.qualquerChaveArmazenamento);
        if (seletoresQualquer.length || chavesQualquer.length) {
            const achouDom = seletoresQualquer.some(existeSeletor);
            const achouChave = chavesQualquer.some(temChaveLocal);
            if (!achouDom && !achouChave) return false;
        }

        if (comoLista(def.todosSeletores).some(function (s) { return !existeSeletor(s); })) return false;
        if (comoLista(def.nenhumSeletor).some(existeSeletor)) return false;

        const hash = window.location.hash || "";
        if (def.hashContem && hash.indexOf(interpolar(def.hashContem)) === -1) return false;
        if (def.hashNaoContem && hash.indexOf(interpolar(def.hashNaoContem)) !== -1) return false;

        return true;
    }

    /* ------------------------------------------------------------------ *
     * Regras: condicoes e acoes
     * ------------------------------------------------------------------ */

    function estadoDaRegra(id) {
        if (!execucoes.has(id)) {
            execucoes.set(id, {
                tentativas: 0,
                concluida: false,
                primeiroMatchMs: 0,
                ultimaTentativaMs: 0,
                avisouLimite: false
            });
        }
        return execucoes.get(id);
    }

    function regraValeParaModo(regra) {
        const modos = (regra.quando || {}).modos;
        if (!modos || modos === "*") return true;
        return comoLista(modos).indexOf(intencao.modo) !== -1;
    }

    function condicoesAtendidas(regra) {
        const quando = regra.quando || {};

        if (!regraValeParaModo(regra)) return false;

        const faltando = comoLista(quando.requerParametros).filter(function (p) {
            return !intencao[p];
        });
        if (faltando.length) return false;

        const href = window.location.href;
        if (quando.urlContem && href.indexOf(interpolar(quando.urlContem)) === -1) return false;
        if (quando.urlNaoContem && href.indexOf(interpolar(quando.urlNaoContem)) !== -1) return false;

        const hash = window.location.hash || "";
        if (quando.hashContem && hash.indexOf(interpolar(quando.hashContem)) === -1) return false;
        if (quando.hashNaoContem && hash.indexOf(interpolar(quando.hashNaoContem)) !== -1) return false;
        if (quando.hashIgual && hash !== interpolar(quando.hashIgual)) return false;

        if (comoLista(quando.seletorExiste).some(function (s) { return !existeSeletor(s); })) return false;
        if (comoLista(quando.seletorAusente).some(existeSeletor)) return false;

        const estados = quando.estados || {};
        const estadoDivergente = Object.keys(estados).some(function (nome) {
            return avaliarEstado(nome) !== !!estados[nome];
        });
        if (estadoDivergente) return false;

        const pendente = comoLista(quando.regrasConcluidas).some(function (id) {
            const est = execucoes.get(id);
            return !est || !est.concluida;
        });
        if (pendente) return false;

        return true;
    }

    /** Escolhe os candidatos de um clique aplicando filtro por atributo/texto. */
    function selecionarAlvos(acao) {
        let elementos;
        try {
            elementos = Array.prototype.slice.call(document.querySelectorAll(acao.seletor));
        } catch (e) {
            aviso("seletor invalido em acao: " + acao.seletor, e);
            return [];
        }

        if (acao.exigirVisivel !== false) {
            elementos = elementos.filter(visivel);
        }

        const filtro = acao.filtro;
        if (filtro) {
            const alvo = normalizar(interpolar(filtro.contem || filtro.igual || ""));
            // Sem "atributo" vale o nome acessivel, que cobre aria-label,
            // aria-labelledby (tooltip), title e o texto do elemento.
            const rotuloDe = function (el) {
                return filtro.atributo ? el.getAttribute(filtro.atributo) || "" : nomeAcessivel(el);
            };
            const candidatos = !alvo ? [] : elementos.filter(function (el) {
                const valor = normalizar(rotuloDe(el));
                return filtro.igual ? valor === alvo : valor.indexOf(alvo) !== -1;
            });

            if (candidatos.length) {
                elementos = candidatos;
            } else {
                const politica = filtro.quandoNaoEncontrar || "ignorar";
                if (politica === "primeiro") {
                    aviso('filtro "' + alvo + '" nao casou em ' + acao.seletor + "; usando o primeiro elemento");
                    elementos = elementos.slice(0, 1);
                } else if (politica === "unico" && elementos.length === 1) {
                    aviso('filtro "' + alvo + '" nao casou em ' + acao.seletor + "; existe apenas uma opcao, usando ela");
                } else {
                    if (elementos.length) {
                        aviso(
                            'filtro "' + alvo + '" nao casou em ' + acao.seletor + "; nada sera clicado. Opcoes: " +
                            elementos.map(function (el) {
                                return '"' + String(rotuloDe(el)).trim() + '"';
                            }).join(" | ")
                        );
                    }
                    elementos = [];
                }
            }
        }

        if (typeof acao.indice === "number") {
            elementos = elementos[acao.indice] ? [elementos[acao.indice]] : [];
        }

        return elementos;
    }

    function acaoClicar(acao) {
        const alvos = selecionarAlvos(acao);
        if (!alvos.length) return false;
        const alvo = alvos[0];
        try {
            if (typeof alvo.focus === "function") alvo.focus({ preventScroll: true });
        } catch (e) {
            /* focar e apenas um reforco */
        }
        alvo.click();
        const rotulo = acao.filtro && acao.filtro.atributo
            ? alvo.getAttribute(acao.filtro.atributo) || ""
            : nomeAcessivel(alvo);
        log("clique em " + acao.seletor + (String(rotulo).trim() ? ' -> "' + String(rotulo).trim() + '"' : ""));
        return true;
    }

    function acaoNavegarHash(acao) {
        const alvo = interpolar(acao.valor || "");
        if (!alvo) return false;
        const atual = window.location.hash || "";
        if (atual !== alvo) {
            log("navegando: " + (atual || "(vazio)") + " -> " + alvo);
            window.location.hash = alvo;
            return true;
        }
        if (acao.reemitirSeIgual) {
            // O hash ja e o desejado mas a tela nao chegou (o Element pode ter
            // ignorado a rota durante o login). Reemitir o evento faz o
            // roteador do Element processar a rota outra vez.
            log("hash ja e " + alvo + "; reemitindo hashchange");
            let evento;
            try {
                evento = new HashChangeEvent("hashchange", {
                    newURL: window.location.href,
                    oldURL: window.location.href
                });
            } catch (e) {
                evento = new Event("hashchange");
            }
            window.dispatchEvent(evento);
            return true;
        }
        return false;
    }

    /**
     * Anota dados na sessao. Serve para marcar "login em andamento" antes de
     * sair da pagina para o provedor de SSO: e essa marca que autoriza o modo
     * kiosk a ser herdado da sessao quando o provedor devolve o usuario sem a
     * query string original.
     */
    function acaoMarcarSessao(acao) {
        const dados = acao.dados || {};
        gravarSessao(dados);
        depurar("sessao marcada", dados);
        return true;
    }

    function executarAcao(acao) {
        switch (acao.tipo) {
            case "clicar":
                return acaoClicar(acao);
            case "navegarHash":
                return acaoNavegarHash(acao);
            case "marcarSessao":
                return acaoMarcarSessao(acao);
            case "recarregarPagina":
                log("recarregando a pagina por acao de regra");
                window.location.reload();
                return true;
            case "log":
                log(interpolar(acao.mensagem || ""));
                return true;
            case "parar":
                log("automacao encerrada por acao de regra");
                parar();
                return true;
            default:
                aviso('acao de tipo desconhecido: "' + acao.tipo + '"');
                return false;
        }
    }

    function tentarRegra(regra) {
        if (regra.ativo === false) return false;
        if (!regra.id) {
            aviso("regra sem id ignorada", regra);
            return false;
        }

        const est = estadoDaRegra(regra.id);
        if (est.concluida) return false;

        if (!condicoesAtendidas(regra)) {
            est.primeiroMatchMs = 0; // recomeca a contagem do atraso inicial
            return false;
        }

        const instante = agora();
        if (!est.primeiroMatchMs) {
            est.primeiroMatchMs = instante;
            depurar('regra "' + regra.id + '" passou a casar');
        }

        const atraso = Number(regra.atrasoInicialMs || 0);
        if (atraso > 0 && instante - est.primeiroMatchMs < atraso) return false;

        const espera = Number(regra.esperaEntreTentativasMs || 0);
        if (est.ultimaTentativaMs && instante - est.ultimaTentativaMs < espera) return false;

        const maximo = Number(regra.tentativasMaximas || 0);
        if (maximo > 0 && est.tentativas >= maximo) {
            if (!est.avisouLimite) {
                aviso('regra "' + regra.id + '" atingiu o limite de ' + maximo + " tentativas");
                est.avisouLimite = true;
            }
            return false;
        }

        est.tentativas += 1;
        est.ultimaTentativaMs = instante;

        const acoes = comoLista(regra.acoes);
        let executou = acoes.length > 0;
        for (let i = 0; i < acoes.length; i += 1) {
            if (!executarAcao(acoes[i])) {
                executou = false;
                break;
            }
        }

        if (executou) {
            log('regra "' + regra.id + '" executada (tentativa ' + est.tentativas + ")");
            if (regra.umaVez !== false) est.concluida = true;
        } else {
            depurar('regra "' + regra.id + '" nao concluiu (tentativa ' + est.tentativas + ")");
        }
        return executou;
    }

    /* ------------------------------------------------------------------ *
     * Laco principal
     * ------------------------------------------------------------------ */

    function regrasDoModo() {
        return comoLista(config.regras).filter(function (regra) {
            return regra.ativo !== false && regraValeParaModo(regra);
        });
    }

    function ciclo() {
        if (!ativo) return;

        const cfgPolling = config.polling || CONFIG_MINIMA.polling;
        const limite = Number(cfgPolling.duracaoMaximaMs || 0);
        if (limite > 0 && agora() - inicioMs > limite) {
            aviso("tempo maximo de automacao (" + limite + "ms) atingido; parando");
            parar();
            return;
        }

        let agiu = false;
        comoLista(config.regras).forEach(function (regra) {
            try {
                agiu = tentarRegra(regra) || agiu;
            } catch (e) {
                erro('falha ao executar a regra "' + (regra && regra.id) + '"', e);
            }
        });

        if (agiu) {
            intervaloAtual = cfgPolling.intervaloInicialMs;
        } else {
            intervaloAtual = Math.min(
                Math.round(intervaloAtual * (cfgPolling.fatorBackoff || 1.4)),
                cfgPolling.intervaloMaximoMs
            );
        }
        agendar(intervaloAtual);
    }

    function agendar(ms) {
        if (temporizador) clearTimeout(temporizador);
        temporizador = setTimeout(ciclo, ms);
    }

    /** Reage a mudancas de DOM/hash: volta ao ritmo rapido e avalia logo. */
    function acordar(motivo) {
        if (!ativo) return;
        const cfgPolling = config.polling || CONFIG_MINIMA.polling;
        if (temporizadorDebounce) return;
        temporizadorDebounce = setTimeout(function () {
            temporizadorDebounce = null;
            intervaloAtual = cfgPolling.intervaloInicialMs;
            depurar("reavaliando regras (" + motivo + ")");
            ciclo();
        }, cfgPolling.debounceMutacaoMs || 120);
    }

    function ligarObservadores() {
        const cfgPolling = config.polling || CONFIG_MINIMA.polling;
        if (cfgPolling.observarMutacoes !== false && document.body && !observador) {
            observador = new MutationObserver(function () {
                acordar("mutacao no DOM");
            });
            observador.observe(document.body, { childList: true, subtree: true });
        }
        window.addEventListener("hashchange", aoMudarRota);
        window.addEventListener("popstate", aoMudarRota);
    }

    function desligarObservadores() {
        if (observador) {
            observador.disconnect();
            observador = null;
        }
        window.removeEventListener("hashchange", aoMudarRota);
        window.removeEventListener("popstate", aoMudarRota);
    }

    function aoMudarRota() {
        acordar("mudanca de rota");
    }

    function iniciarAutomacao() {
        const pendentes = regrasDoModo();
        if (!pendentes.length) {
            log('modo "' + intencao.modo + '": nenhuma regra aplicavel, automacao desligada');
            return;
        }
        ativo = true;
        inicioMs = agora();
        intervaloAtual = (config.polling || CONFIG_MINIMA.polling).intervaloInicialMs;
        log(
            'modo "' + intencao.modo + '" com ' + pendentes.length + " regra(s)" +
            (intencao.sala ? ', sala "' + intencao.sala + '"' : ", sem sala") +
            (intencao.sso ? ', sso "' + intencao.sso + '"' : "")
        );
        ligarObservadores();
        ciclo();
    }

    function parar() {
        ativo = false;
        if (temporizador) clearTimeout(temporizador);
        if (temporizadorDebounce) clearTimeout(temporizadorDebounce);
        temporizador = null;
        temporizadorDebounce = null;
        desligarObservadores();
    }

    function reiniciar() {
        parar();
        execucoes.clear();
        intencao = resolverIntencao();
        aplicarClassesDeModo();
        marcarOrigemConfig();
        montarBotaoAlternarModo();
        iniciarAutomacao();
    }

    /* ------------------------------------------------------------------ *
     * Carga da configuracao e inicializacao
     * ------------------------------------------------------------------ */

    function validarConfig(bruta) {
        if (!ehObjeto(bruta)) throw new Error("navegacaoKiosk.json nao contem um objeto");
        if (bruta.regras && !Array.isArray(bruta.regras)) throw new Error('"regras" precisa ser uma lista');
        const vistos = {};
        comoLista(bruta.regras).forEach(function (regra) {
            if (!regra.id) aviso("ha uma regra sem id em navegacaoKiosk.json", regra);
            else if (vistos[regra.id]) aviso('id de regra repetido: "' + regra.id + '"');
            else vistos[regra.id] = true;
        });
        return bruta;
    }

    function carregarConfig() {
        return fetch(URL_CONFIG, { cache: "no-cache", credentials: "same-origin" })
            .then(function (resposta) {
                if (!resposta.ok) throw new Error("HTTP " + resposta.status);
                return resposta.json();
            })
            .then(function (bruta) {
                configDoArquivo = mesclar(clonar(CONFIG_MINIMA), validarConfig(bruta));
                config = configDoArquivo;
                origemConfig = "arquivo";
                configCarregada = true;
                depurar("configuracao carregada", config);
            })
            .catch(function (e) {
                erro(
                    "nao foi possivel carregar " + URL_CONFIG + " (" + e.message + "). " +
                    "O Element segue funcionando, mas sem automacao de navegacao."
                );
            })
            .then(usarConfigTemporariaSeExistir);
    }

    /* ------------------------------------------------------------------ *
     * Ajustes pelo console: injetar um navegacaoKiosk.json sem rebuild
     * ------------------------------------------------------------------ */

    function chaveConfigTemporaria() {
        return (config.sessao && config.sessao.chaveConfigTemporaria) || "kioskCND:configTemporaria";
    }

    function lerConfigTemporaria() {
        const armazem = deposito();
        if (!armazem) return null;
        try {
            const bruto = armazem.getItem(chaveConfigTemporaria());
            if (!bruto) return null;
            const pacote = JSON.parse(bruto);
            const validade = Number((config.sessao && config.sessao.validadeConfigTemporariaMs) || 0);
            if (validade > 0 && pacote.gravadoEm && agora() - pacote.gravadoEm > validade) {
                aviso("configuracao temporaria expirou; voltando para " + URL_CONFIG);
                armazem.removeItem(chaveConfigTemporaria());
                return null;
            }
            return pacote.config || null;
        } catch (e) {
            aviso("configuracao temporaria ilegivel; sera descartada", e);
            limparConfig();
            return null;
        }
    }

    function usarConfigTemporariaSeExistir() {
        const guardada = lerConfigTemporaria();
        if (!guardada) return;
        config = mesclar(clonar(CONFIG_MINIMA), guardada);
        origemConfig = "temporaria";
        aviso(
            "usando a configuracao TEMPORARIA injetada pelo console (localStorage), " +
            "e nao " + URL_CONFIG + ". Use kioskCND.limparConfig() para voltar ao arquivo."
        );
    }

    function marcarOrigemConfig() {
        const raiz = document.documentElement;
        if (raiz) raiz.setAttribute("data-kiosk-cnd-config", origemConfig);
    }

    /**
     * Troca a configuracao em memoria e reinicia a automacao.
     *
     * @param {object|string} bruta  objeto ou texto JSON no formato do navegacaoKiosk.json
     * @param {object} [opcoes]      { mesclar: true } aplica como remendo sobre a atual,
     *                               { persistir: true } guarda no localStorage
     */
    function aplicarConfig(bruta, opcoes) {
        opcoes = opcoes || {};
        const objeto = typeof bruta === "string" ? JSON.parse(bruta) : bruta;
        validarConfig(objeto);

        const base = opcoes.mesclar ? config : clonar(CONFIG_MINIMA);
        config = mesclar(base, objeto);
        origemConfig = "temporaria";

        if (opcoes.persistir) {
            const armazem = deposito();
            if (armazem) {
                armazem.setItem(
                    chaveConfigTemporaria(),
                    JSON.stringify({ gravadoEm: agora(), config: config })
                );
                log("configuracao temporaria guardada; sobrevive a recargas e ao SSO");
            } else {
                aviso("sem armazenamento disponivel: a configuracao vale so nesta pagina");
            }
        }

        log(
            "configuracao " + (opcoes.mesclar ? "remendada" : "substituida") +
            " pelo console (" + comoLista(config.regras).length + " regra(s))"
        );
        reiniciar();
        return diagnostico();
    }

    /** Remendo sobre a configuracao atual, ex.: ajustarConfig({ log: { nivel: "debug" } }). */
    function ajustarConfig(remendo, opcoes) {
        return aplicarConfig(remendo, Object.assign({ mesclar: true }, opcoes || {}));
    }

    /** Guarda a configuracao atual (ou a informada) para sobreviver a recargas. */
    function salvarConfig(bruta) {
        return aplicarConfig(bruta === undefined ? config : bruta, { persistir: true });
    }

    /** Descarta a configuracao injetada e volta para o navegacaoKiosk.json. */
    function limparConfig() {
        const armazem = deposito();
        if (armazem) {
            try {
                armazem.removeItem(chaveConfigTemporaria());
            } catch (e) {
                /* ignorado */
            }
        }
        if (configDoArquivo) {
            config = configDoArquivo;
            origemConfig = "arquivo";
            log("de volta a configuracao de " + URL_CONFIG);
            reiniciar();
            return diagnostico();
        }
        log("configuracao temporaria removida; recarregue a pagina");
        return null;
    }

    /** Texto pronto para colar em buildKiosk/navegacaoKiosk.json. */
    function exportarConfig() {
        return JSON.stringify(config, null, 2);
    }

    /**
     * Lista o que um seletor encontra na tela, com o nome acessivel de cada
     * elemento - o mesmo valor que o filtro das regras compara.
     */
    function inspecionar(seletor) {
        let elementos = [];
        try {
            elementos = Array.prototype.slice.call(document.querySelectorAll(seletor));
        } catch (e) {
            erro("seletor invalido: " + seletor, e);
            return [];
        }
        const achados = elementos.map(function (el, indice) {
            return {
                indice: indice,
                nome: String(nomeAcessivel(el)).trim(),
                visivel: visivel(el),
                tag: el.tagName.toLowerCase(),
                classes: el.className,
                html: el.outerHTML.slice(0, 200)
            };
        });
        console.log(prefixo() + " " + achados.length + " elemento(s) em " + seletor);
        if (console.table) console.table(achados.map(function (a) {
            return { indice: a.indice, nome: a.nome, visivel: a.visivel, tag: a.tag };
        }));
        return achados;
    }

    /** Roda uma regra agora, ignorando "umaVez" e os limites de tentativa. */
    function testarRegra(id) {
        const regra = comoLista(config.regras).filter(function (r) { return r.id === id; })[0];
        if (!regra) {
            erro('nao existe regra com id "' + id + '"');
            return false;
        }
        execucoes.delete(id);
        const casa = condicoesAtendidas(regra);
        log('regra "' + id + '": condicoes ' + (casa ? "atendidas" : "NAO atendidas"));
        if (!casa) return false;
        const acoes = comoLista(regra.acoes);
        let ok = acoes.length > 0;
        for (let i = 0; i < acoes.length; i += 1) {
            if (!executarAcao(acoes[i])) {
                ok = false;
                break;
            }
        }
        return ok;
    }

    function ajuda() {
        console.log(
            [
                prefixo() + " comandos disponiveis no console",
                "",
                "  kioskCND.diagnostico()                  modo, estados e situacao de cada regra",
                "  kioskCND.inspecionar('.mx_SSOButton')   lista elementos e o nome acessivel de cada um",
                "  kioskCND.testarRegra('entrarNaSala')    roda uma regra agora, sem limites",
                "",
                "  kioskCND.aplicarConfig(json)            troca o navegacaoKiosk.json em memoria",
                "  kioskCND.ajustarConfig(remendo)         remenda so um pedaco da configuracao",
                "  kioskCND.salvarConfig(json?)            guarda no localStorage (sobrevive a recargas e ao SSO)",
                "  kioskCND.limparConfig()                 volta para o " + URL_CONFIG,
                "  kioskCND.exportarConfig()               texto pronto para colar no arquivo",
                "  kioskCND.recarregarConfig()             rele o arquivo servido pelo container",
                "",
                "  kioskCND.reiniciar()  kioskCND.parar()  kioskCND.limparSessao()",
                "",
                "Exemplos:",
                "  kioskCND.ajustarConfig({ log: { nivel: 'debug' } })",
                "  kioskCND.salvarConfig({ ...umJsonInteiro })",
                "  copy(kioskCND.exportarConfig())   // DevTools: copia para a area de transferencia"
            ].join("\n")
        );
        return undefined;
    }

    function quandoDomPronto(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback, { once: true });
        } else {
            callback();
        }
    }

    function iniciar() {
        // Passo sincrono: define o modo e a classe no <html> antes da primeira
        // pintura, para o kiosk nao piscar a interface completa do Element.
        intencao = resolverIntencao();
        aplicarClassesDeModo();

        carregarConfig().then(function () {
            // A configuracao real pode renomear parametros e mudar padroes.
            intencao = resolverIntencao();
            aplicarClassesDeModo();
            marcarOrigemConfig();
            quandoDomPronto(function () {
                montarBotaoAlternarModo();
                iniciarAutomacao();
            });
        });
    }

    /** Relatorio de depuracao para colar no console do kiosk. */
    function diagnostico() {
        const estados = {};
        Object.keys(config.estados || {}).forEach(function (nome) {
            estados[nome] = avaliarEstado(nome);
        });

        const regras = comoLista(config.regras).map(function (regra) {
            const est = execucoes.get(regra.id) || {};
            return {
                id: regra.id,
                ativa: regra.ativo !== false,
                doModo: regraValeParaModo(regra),
                casaAgora: regra.ativo !== false && condicoesAtendidas(regra),
                tentativas: est.tentativas || 0,
                concluida: !!est.concluida
            };
        });

        const relatorio = {
            configCarregada: configCarregada,
            origemConfig: origemConfig,
            automacaoAtiva: ativo,
            intervaloAtualMs: intervaloAtual,
            intencao: intencao,
            hash: window.location.hash,
            estados: estados,
            regras: regras
        };
        console.log(prefixo() + " diagnostico", relatorio);
        if (console.table) console.table(regras);
        return relatorio;
    }

    iniciar();

    return {
        get config() { return config; },
        get intencao() { return intencao; },
        get ativo() { return ativo; },
        get origemConfig() { return origemConfig; },
        ajuda: ajuda,
        avaliarEstado: avaliarEstado,
        diagnostico: diagnostico,
        inspecionar: inspecionar,
        testarRegra: testarRegra,
        alternarModo: alternarModo,
        aplicarConfig: aplicarConfig,
        ajustarConfig: ajustarConfig,
        salvarConfig: salvarConfig,
        limparConfig: limparConfig,
        exportarConfig: exportarConfig,
        recarregarConfig: function () {
            return carregarConfig().then(reiniciar);
        },
        reiniciar: reiniciar,
        parar: parar,
        limparSessao: limparSessao
    };
})();
