# Extrator de Sites

> Extensão open source para Google Chrome 116 ou mais novo · **Versão:** 1.0.0 · Licença [MIT](LICENSE)

Salva uma cópia de um site no seu computador, com animações, modelos 3D, texturas e fontes funcionando, pronta para abrir sem internet. Também gera um **design system** com as cores, fontes e componentes do site.

Roda inteira no navegador: sem conta, sem servidor, sem coleta de dados.

- **Código:** <https://github.com/parrelladev/extrator-de-sites>
- **Problemas e ideias:** abra uma *issue* em <https://github.com/parrelladev/extrator-de-sites/issues>
- **Autor:** [@parrelladev](https://github.com/parrelladev)

Este documento tem duas partes:

- **Parte A — Como usar:** o que a extensão faz e como usar, passo a passo.
- **Parte B — Por dentro:** como o código é organizado e como contribuir.

---

# Parte A — Como usar

## 1. O que é

O **Extrator de Sites** é uma extensão do Chrome que **baixa uma cópia de um site para o seu computador**. A cópia mantém animações, modelos 3D, texturas e fontes funcionando, e pode ser aberta **sem internet**.

Também pode gerar um **design system**: uma página com as cores, fontes e componentes usados pelo site.

## 2. O que você precisa

| Item | Para quê |
|---|---|
| Google Chrome 116 ou mais novo | Para rodar a extensão |
| **Python 3** instalado no computador | Só para **abrir** o site baixado. Baixe em python.org/downloads. No Windows, marque a opção **"Add Python to PATH"** ao instalar. |

## 3. Como instalar (do zero)

**Não precisa compilar nada.** A extensão é feita de arquivos HTML, CSS e JavaScript puros, que o Chrome lê direto desta pasta. Não há `npm install` nem etapa de build.

### Instalar do zero

0. **Baixe o código:** no GitHub, clique em **Code → Download ZIP** e descompacte, ou use `git clone https://github.com/parrelladev/extrator-de-sites.git`.
1. **Se já existe uma versão antiga instalada** (por exemplo, uma cópia mais antiga com outro nome), remova antes: abra `chrome://extensions`, ache a extensão e clique em **Remover**. A versão nova tem outra identificação e não substitui a antiga sozinha.
2. Abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta `extrator-de-sites` (a que tem o `manifest.json` dentro).

Logo após carregar, o Chrome abre sozinho o Estúdio.

### Depois de mudar o código

Em `chrome://extensions`, clique no botão de **recarregar** (a seta circular) no cartão da extensão. Se o Estúdio estiver aberto, feche a aba e abra de novo pelo ícone.

### Gerar um pacote para outro computador (opcional)

- **Jeito mais simples:** compacte a pasta `extrator-de-sites` num `.zip`. No outro computador, descompacte e siga os passos de "Instalar do zero".
- **Arquivo `.crx`:** em `chrome://extensions`, clique em **Compactar extensão** e escolha a pasta. O Chrome gera um `.crx` e um `.pem` (a chave). Guarde o `.pem` e não o compartilhe: é ele que mantém a mesma identificação nas próximas versões. O Chrome costuma bloquear `.crx` que não vêm da loja, por isso a pasta ou o `.zip` é o caminho mais garantido.

## 4. Como abrir

Clique no **ícone da extensão** na barra do Chrome. Abre uma nova aba chamada **Estúdio**. Tudo acontece nela.

## 5. Como baixar um site (passo a passo)

1. Abra o site que você quer copiar numa aba do Chrome.
2. Clique no ícone da extensão para abrir o Estúdio.
3. Em **01 Endereço**, confira o endereço. Se estiver errado, clique em **"Aba atual"**.
4. Em **02 Modo de captura**, escolha um modo (veja a tabela abaixo).
5. Clique em **"Capturar site"**.
6. Escolha **onde salvar**: uma pasta no computador (padrão) ou um arquivo `.zip`.
7. Espere a barra chegar a 100%. **Não feche a aba do site nem a do Estúdio** durante a captura.

### Os três modos

| Modo | O que faz | Quando usar |
|---|---|---|
| **Completo** (recomendado) | Rola a página inteira, procura arquivos no código e baixa bibliotecas externas. | Na maioria dos casos. |
| **Rápido** (~30 s) | Pega só o que a página já carregou. Sem vídeo e áudio. | Sites simples. |
| **Site inteiro** (demorado) | Segue os links do menu e copia cada página (até 2 níveis, até 60 páginas). | Quando você quer várias páginas. |

### Ajustes finos (opcional)

Clique em **"Ajustes finos"** para mudar detalhes. Os mais úteis:

| Opção | Para que serve |
|---|---|
| **Passadas de rolagem** | Se faltar imagem na cópia, suba para **2**. |
| **Seguir links** / **Limite de páginas** | Quantas páginas copiar. |
| **Vídeo e áudio** | Desligue para ocupar menos espaço. |
| **Descartar rastreadores** | Não baixa ferramentas de estatística (Analytics, Pixel, Hotjar). Ligado por padrão. |
| **Extrair design system** | Gera a página de cores, fontes e componentes. |
| **Trazer a aba para frente ao rolar** | Deixe ligado: o Chrome "congela" abas escondidas. |
| **Destino** | Pasta no disco ou arquivo .zip. Evite .zip acima de 1 GB. |

O Estúdio **lembra suas escolhas** para a próxima vez.

## 6. Como abrir o site baixado

> ⚠️ **Não abra o `index.html` com dois cliques.** Aberto direto do disco, o navegador bloqueia partes importantes do site (3D, fontes, animações).

Se você escolheu **.zip**, descompacte primeiro. O arquivo se chama algo como `exemplo.com-2026-11-14.zip`.

### No Windows

1. Abra a pasta do site baixado.
2. Dê dois cliques em **`ABRIR SITE.cmd`**.
3. O site abre no navegador. Deixe a janela preta aberta enquanto usa o site; feche-a para desligar.

### No Mac

Na **primeira vez**, o macOS bloqueia o atalho, com o aviso de que "a Apple não pode verificar" o arquivo. Isso é esperado. Faça assim **uma única vez**:

1. Abra o **Terminal**.
2. Digite `bash` e um espaço.
3. Arraste o arquivo **`ABRIR SITE.command`** para dentro da janela do Terminal.
4. Aperte **Enter**.

Depois disso, o duplo clique passa a funcionar.

### Opções avançadas do servidor

O atalho liga um pequeno "servidor local", um programa que entrega o site ao navegador como se fosse a internet. Quem quiser pode rodá-lo à mão, de dentro da pasta do site:

| Comando | Efeito |
|---|---|
| `python3 __offline/servidor.py` | Usa a porta 8080 |
| `python3 __offline/servidor.py 3000` | Usa outra porta (3000) |
| `... --isolar` | Liga um modo extra de isolamento, para alguns sites 3D |
| `... --sem-navegador` | Não abre o navegador sozinho |

### O que vem na pasta

| Arquivo ou pasta | O que é |
|---|---|
| `ABRIR SITE.cmd` / `ABRIR SITE.command` | O atalho que abre o site. **É o único que você precisa usar.** |
| `__offline/` | Arquivos de apoio, incluindo o servidor local. |
| `design-system.html` | Página com cores, fontes e componentes (se a opção estava ligada). |
| `design-system/` | `tokens.css` (pronto para colar em outro projeto) e `tokens.json` (os dados completos). |

## 7. Problemas comuns

| Problema | O que fazer |
|---|---|
| "Python 3 não encontrado" | Instale o Python (seção 2). No Windows, marque "Add Python to PATH". No Mac, também dá para usar `xcode-select --install`. |
| Faltam imagens na cópia | Em *Ajustes finos*, suba **Passadas de rolagem** para 2 e capture de novo. |
| A captura travou ou falhou | Confira se a aba do site continua aberta, recarregue a página e tente de novo. Abra **"Detalhes técnicos"** para ver onde parou. |
| Alguns recursos "não vieram" | Quase sempre são rastreadores ou arquivos que exigem login. A lista aparece no fim da captura. |
| "Seletor de pastas indisponível" | O Estúdio passa a salvar em `.zip` automaticamente. |

## 8. Permissões que a extensão pede, em palavras simples

| Permissão | Por que é necessária |
|---|---|
| **Ler e alterar dados em todos os sites** | Para baixar os arquivos do site escolhido, venham de onde vierem. |
| **scripting** (rodar código nas páginas) | Para observar quais arquivos o site carrega durante a captura. |
| **tabs** (ver as abas) | Para descobrir o endereço da aba atual e rolar a página. |
| **storage** (guardar dados) | Para lembrar suas preferências. |
| **downloads** | Para salvar o arquivo `.zip`. |

## 9. Privacidade e uso responsável

- **O "coletor" só fica ligado durante a captura.** Fora dela, a extensão não observa os sites que você visita.
- **⚠️ Cuidado com sites em que você está logado.** Durante a captura, a extensão guarda as respostas que o site recebe para funcionar sem internet. Se você estiver logado no site (e-mail, banco, painel interno), **dados pessoais podem acabar dentro da cópia**. **Recomendação:** capture sempre deslogado ou numa janela sem login.
- **Direitos autorais:** copie apenas sites que você tem direito de copiar (seus próprios sites, ou com autorização do dono). Textos, imagens, fontes e códigos de terceiros têm dono.
- **Nada sai do seu computador:** a extensão não tem servidor próprio. Ela só acessa o site que você está copiando, e as preferências ficam guardadas no próprio navegador.

---

# Parte B — Por dentro

## 10. Mapa dos arquivos

```text
extrator-de-sites/
├── manifest.json          Ficha técnica da extensão (nome, versão, permissões)
├── icons/                 Ícones 16, 32, 48 e 128 px
└── src/
    ├── background.js      "Bastidor": abre o Estúdio e liga/desliga os coletores
    ├── studio/            A tela do Estúdio (HTML, CSS e lógica da interface)
    ├── content/
    │   ├── hooks.js       Coletor que registra cada arquivo que a página carrega
    │   └── bridge.js      Ponte entre a página e o Estúdio
    ├── core/              O motor da captura
    │   ├── capture.js     Comanda a captura de ponta a ponta
    │   ├── fetcher.js     Baixa os arquivos
    │   ├── html.js / css.js / js.js / urlmap.js   Ajustam os endereços nos arquivos
    │   ├── design*.js     Extraem o design system
    │   ├── writer.js      Grava em pasta ou em .zip
    │   ├── zip.js         Monta o .zip
    │   └── util.js        Funções de apoio
    └── templates/         Arquivos copiados para dentro de cada site baixado
        ├── abrir-site.cmd.tpl       Atalho do Windows
        ├── abrir-site.command.tpl   Atalho do Mac/Linux
        ├── servidor.py.tpl          Servidor local em Python
        ├── runtime.js               Camada que redireciona endereços na cópia
        └── worker-runtime.js        O mesmo, para "workers" (tarefas em segundo plano do site)
```

Os nomes e os comentários desses arquivos deixam claro o papel de cada um.

## 11. Como funciona por dentro

- **Quem faz o trabalho pesado é a página do Estúdio**, não o "bastidor" (`background.js`). O Chrome pode desligar o bastidor no meio de uma tarefa longa; a página do Estúdio fica viva a captura inteira.
- **Os coletores ficam ligados só durante a captura.** O Estúdio pede ao bastidor para "armar" os coletores (`hooks.js` e `bridge.js`) no início e "desarmar" no fim. Se a aba do Estúdio fechar, ou se o Chrome reiniciar, eles são desligados.
- **Só a própria extensão pode dar ordens ao bastidor.** Mensagens vindas de páginas de terceiros são recusadas.
- **Limites do coletor:** guarda no máximo 2 MB por resposta e 24 MB no total.
- **A cópia guarda o HTML original**, não a tela já desenhada. Assim as animações começam do zero, como no site real. Uma camada (`runtime.js`) redireciona cada endereço para o arquivo baixado.

## 12. Como contribuir

Contribuições são bem-vindas.

1. Faça um *fork* do repositório e crie um *branch* para a sua mudança.
2. Carregue a extensão pela pasta (seção 3) e teste a captura em alguns sites.
3. Abra um *pull request* explicando o que mudou e por quê.

Não há etapa de build nem dependências: é só HTML, CSS e JavaScript.

## 13. Licença

Distribuído sob a licença MIT. Veja o arquivo [LICENSE](LICENSE).
