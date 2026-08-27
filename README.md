# ElementKiosk

Element Web auto-hospedado em **modo kiosk de atendimento**: o cliente abre um
link, o login por SSO acontece sozinho e a sala do chamado abre direto.

A automação é declarativa: `buildKiosk/kioskCND.js` é só o motor, e todas as
regras de navegação ficam em **`buildKiosk/navegacaoKiosk.json`**. Mudar
comportamento normalmente significa editar apenas esse JSON.

---

## URL de atendimento

```
https://chat.casanovadigital.com.br/?salaConversa=%23chamadocliente110_ct%3Acasanovadigital.com.br&modo=kiosk&sso=Casanova
```

| Parâmetro      | Obrigatório | Efeito                                                                 |
| -------------- | ----------- | ---------------------------------------------------------------------- |
| `salaConversa` | não         | sala aberta após o login (apelido `#sala:servidor` ou id `!id:servidor`) |
| `modo`         | não         | `kiosk` (automação + interface reduzida) ou `normal` (Element completo) |
| `sso`          | não         | provedor de SSO; casa com o `aria-label` do botão                      |

**Sem `modo` na URL o resultado é o Element normal** (`padroes.modo` =
`normal`): nada é clicado e o CSS do kiosk não vale. O modo kiosk é sempre
explícito, com `&modo=kiosk`. Sem `sso`, vale `padroes.sso` (hoje `Casanova`).

O valor de `salaConversa` pode ir codificado na URL (`%23` = `#`, `%3A` = `:`) —
o motor decodifica e monta o hash no formato que o Element entende.

### Modo normal

É o padrão: basta abrir a URL sem `modo` (ou com `?modo=normal`). Além disso, o
kiosk mostra um botão discreto no canto inferior direito (**"Entrar sem o modo
kiosk"**) que recarrega a mesma tela sem automação e sem o CSS de kiosk. No modo
normal o botão inverte e oferece voltar ao kiosk. Textos e ativação ficam em
`interface.botaoAlternarModo`.

### Desativar o CSS

O `kioskCND.css` é o que esconde o painel esquerdo e deixa só o chat, e ele
**só vale no modo kiosk** — todas as regras são escopadas em
`html.kioskCND--kiosk`, classe que o motor aplica apenas quando
`modo=kiosk`. No modo normal o Element aparece inteiro, com menu e lista de
salas.

Para desligar o CSS **também no modo kiosk** (mantendo os cliques automáticos e
a entrada na sala, mas com a interface completa do Element), em
`navegacaoKiosk.json`:

```json
"interface": { "aplicarCss": false }
```

Com isso nenhuma classe de modo entra no `<html>` e o `kioskCND.css` deixa de
ter efeito — só o botão de troca de modo continua estilizado.

### Depuração no terminal de atendimento

No console do navegador:

```js
kioskCND.diagnostico()   // modo, sala, estados avaliados e situação de cada regra
kioskCND.reiniciar()     // zera contadores e roda as regras de novo
kioskCND.recarregarConfig()
kioskCND.parar()
```

---

## Arquivos

| Arquivo                        | Papel                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| `buildKiosk/navegacaoKiosk.json` | **regras de navegação** (o que editar no dia a dia)                |
| `buildKiosk/kioskCND.js`       | motor que interpreta o JSON                                          |
| `buildKiosk/kioskCND.css`      | estilo do kiosk (escopado em `html.kioskCND--kiosk`)                 |
| `buildKiosk/config.json`       | configuração do Element (homeserver, marca, tema)                    |
| `buildKiosk/entrypoint.sh`     | hook `/docker-entrypoint.d/19-kiosk-cnd.sh` (variáveis de ambiente)  |
| `buildKiosk/Dockerfile`        | build sobre `vectorim/element-web`                                   |
| `compilarEIniciarServico.sh`   | rebuild + restart do container de laboratório                        |

---

## navegacaoKiosk.json

### Blocos de configuração

```jsonc
{
  "parametrosUrl": { "sala": "salaConversa", "modo": "modo", "sso": "sso" },
  "padroes":       { "modo": "normal", "sso": "Casanova", "sala": "" },
  "modosValidos":  ["kiosk", "normal"],

  // A intenção (modo/sala/sso) é guardada aqui para sobreviver ao
  // redirecionamento do SSO, caso o provedor descarte a query string.
  // Com somenteDuranteLogin (padrão), o MODO só é herdado da sessão enquanto
  // existe um login em andamento; fora disso, URL sem ?modo= = Element normal.
  "sessao": {
    "armazenamento": "localStorage",
    "chave": "kioskCND:intencao",
    "validadeMs": 300000,
    "somenteDuranteLogin": true
  },

  "log": { "ativo": true, "prefixo": "kioskCND", "nivel": "info" },

  "polling": {
    "intervaloInicialMs": 250,   // ritmo após cada ação
    "intervaloMaximoMs": 3000,   // ritmo quando nada acontece
    "fatorBackoff": 1.4,
    "duracaoMaximaMs": 0,        // 0 = sem limite de tempo
    "observarMutacoes": true,    // reage a mudanças de DOM, não só ao timer
    "debounceMutacaoMs": 120
  },

  "interface": {
    "classeBase": "kioskCND",
    "classePorModo": { "kiosk": "kioskCND--kiosk", "normal": "kioskCND--normal" },
    "aplicarCss": true,          // false = kioskCND.css sem efeito, automação intacta
    "botaoAlternarModo": { "ativo": true, "classe": "kioskCND_botaoModo", "porModo": { } }
  }
}
```

`nivel` do log: `silencioso`, `erro`, `aviso`, `info`, `debug`.

### Estados

Estado = como reconhecer, olhando o DOM/URL, em que ponto o Element está.
Cada estado é verdadeiro quando **todas** as condições declaradas valem:

| Campo                       | Significado                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `qualquerSeletor`           | pelo menos um desses seletores existe                            |
| `qualquerChaveArmazenamento`| ou pelo menos uma dessas chaves existe no `localStorage`         |
| `todosSeletores`            | todos precisam existir                                           |
| `nenhumSeletor`             | nenhum pode existir                                              |
| `hashContem` / `hashNaoContem` | trecho do hash da URL                                         |

`qualquerSeletor` e `qualquerChaveArmazenamento` formam **uma única** evidência
(basta um dos dois casar). É assim que `logado` funciona: alguma tela interna
visível **ou** credencial guardada, e nenhuma tela de autenticação na frente.

### Regras

```jsonc
{
  "id": "entrarNaSala",                  // obrigatório e único
  "descricao": "…",                      // documentação, ignorada pelo motor
  "ativo": true,                          // false = desligada
  "quando": {
    "modos": ["kiosk"],                  // ou "*"
    "requerParametros": ["sala"],        // só roda se a URL/sessão trouxe isso
    "estados": { "logado": true, "naSala": false },
    "urlContem": "…", "urlNaoContem": "…",
    "hashContem": "…", "hashNaoContem": "…", "hashIgual": "…",
    "seletorExiste": ".x",               // string ou lista (todos)
    "seletorAusente": ".y",              // string ou lista (nenhum)
    "regrasConcluidas": ["outraRegra"]
  },
  "acoes": [ { "tipo": "navegarHash", "valor": "#/room/{{sala}}", "reemitirSeIgual": true } ],
  "umaVez": false,                        // padrão true
  "atrasoInicialMs": 400,                 // espera após a condição passar a valer
  "tentativasMaximas": 20,
  "esperaEntreTentativasMs": 1500
}
```

Nos textos valem os marcadores `{{sala}}`, `{{sso}}` e `{{modo}}`.

Ações disponíveis:

| `tipo`             | Campos                                                     | O que faz |
| ------------------ | ---------------------------------------------------------- | --------- |
| `clicar`           | `seletor`, `filtro`, `indice`, `exigirVisivel`             | clica no primeiro alvo |
| `navegarHash`      | `valor`, `reemitirSeIgual`                                 | troca o hash; se já for igual e `reemitirSeIgual`, força o roteador do Element a reprocessar |
| `marcarSessao`     | `dados`                                                    | anota dados na sessão (ex.: `loginIniciado`) |
| `recarregarPagina` | —                                                          | `location.reload()` |
| `log`              | `mensagem`                                                 | escreve no console |
| `parar`            | —                                                          | encerra a automação |

O `filtro` do `clicar` é o que escolhe o provedor de SSO:

```json
"filtro": { "atributo": "aria-label", "contem": "{{sso}}", "quandoNaoEncontrar": "unico" }
```

- compara sem acentos e sem diferenciar maiúsculas (`Casanova` casa com
  `"Continuar com Casanova Digital"`);
- `contem` (padrão) ou `igual`;
- sem `atributo`, compara o texto do elemento;
- `quandoNaoEncontrar`: `ignorar` (não clica), `unico` (só clica se existir uma
  única opção) ou `primeiro` (clica no primeiro — evite com vários provedores,
  pois loga no provedor errado).

### Regras que já vêm configuradas

| id                            | Para que serve |
| ----------------------------- | -------------- |
| `mobileGuideParaDesktop`      | sai da página "baixe o app" (`/mobile_guide`) |
| `irParaTelaLogin`             | da tela de boas-vindas vai para `#/login`, onde ficam os botões de SSO |
| `loginSsoAutomatico`          | clica no provedor de SSO pedido em `?sso=` |
| `pularVerificacaoDispositivo` | fecha o pedido de verificação de dispositivo |
| `confirmarPularVerificacao`   | confirma "verificar mais tarde" |
| `entrarNaSala`                | abre `?salaConversa=` e insiste se o Element devolver para a home |
| `aceitarConviteDaSala`        | aceita convite / entra na sala quando aparece a barra de prévia |
| `encerrarFluxoDeLogin`        | apaga a marca `loginIniciado` depois do login concluído |
| `fecharDialogosGenericos`     | exemplo desligado (`"ativo": false`) |

---

## Build e execução

```bash
./compilarEIniciarServico.sh          # rebuild + restart em http://localhost:8099
```

O build valida os JSON com `jq` e falha se algum estiver quebrado; também
confere que o `<head>` do Element recebeu o `kioskCND.js`.

A imagem base é a oficial `vectorim/element-web` (roda como usuário `nginx`,
serve `/app`). O `ENTRYPOINT` original é preservado: a customização entra como
hook `/docker-entrypoint.d/19-kiosk-cnd.sh`, e a injeção do JS/CSS acontece no
build — em execução `/app` é somente leitura.

`kioskCND.js`, `kioskCND.css` e `navegacaoKiosk.json` são servidos com
`Cache-Control: no-cache`, então basta recriar o container e dar F5 no terminal.

### Variáveis de ambiente (opcionais)

Se existir um `.env` na raiz (veja `MODELO_ENV.sh` / `.env.example`), ele é
passado ao container e sobrescreve o `config.json` servido:

| Variável                     | Campo do config.json                                |
| ---------------------------- | --------------------------------------------------- |
| `KIOSK_CND_HOME_SERVER_URL`  | `default_server_config."m.homeserver".base_url`     |
| `KIOSK_CND_HOME_SERVER_NAME` | `default_server_config."m.homeserver".server_name`  |
| `KIOSK_CND_BRAND_NAME`       | `brand`                                             |
| `KIOSK_CND_BRAND_IMG_URL`    | `branding.auth_header_logo_url`                     |
| `KIOSK_CND_TEMA`             | `default_theme` (`light` \| `dark`)                  |

---

## Notas de implementação

- **Hash da sala:** o Element lê o trecho depois de `#/room/` **cru**, sem
  decodificar. `#/room/%23sala%3Aservidor` não funciona; tem que ser
  `#/room/#sala:servidor`. Era a causa do kiosk logar e ficar parado na home.
- **Voltar do SSO:** o Element monta a URL de retorno a partir da URL atual, e
  os parâmetros do kiosk sobrevivem ao redirecionamento. Como alguns provedores
  descartam a query string, a intenção também fica no `localStorage` por 5
  minutos (`sessao.validadeMs`). Para o padrão continuar sendo o Element normal,
  o *modo* só é retomado da sessão enquanto há login em andamento — marca
  `loginIniciado`, posta pela regra de SSO e apagada por `encerrarFluxoDeLogin`.
- **`screenAfterLogin`:** o Element só considera o fragmento presente no
  carregamento da página, por isso a sala é aberta pelo motor (com repetição)
  em vez de confiar no roteador dele.
- **Seletores conferidos** na versão da imagem base. Ao subir a versão do
  Element, vale rodar `kioskCND.diagnostico()` e checar se algum estado ficou
  falso — costuma ser renomeação de classe.

Testado em navegadores baseados em Chromium.
