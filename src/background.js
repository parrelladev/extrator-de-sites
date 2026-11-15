/* Service worker minimo: o trabalho pesado acontece na pagina do Estudio,
   que tem host_permissions e pode buscar cross-origin sem esbarrar em CORS. */

chrome.action.onClicked.addListener(async (tab) => {
  const url = chrome.runtime.getURL('src/studio/studio.html') +
    (tab && tab.id ? ('?tab=' + tab.id) : '');
  await chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
});

chrome.runtime.onInstalled.addListener((d) => {
  // Registro que tenha sobrado de uma versao anterior nao pode ficar ativo.
  desarmar().catch(() => {});
  if (d.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/studio/studio.html') });
  }
});

/*
 * Coletores sob demanda.
 *
 * hooks.js intercepta fetch/XHR e guarda o corpo das respostas. Isso so faz
 * sentido na aba que esta sendo capturada — ficar ligado em toda pagina que o
 * usuario abre copiaria para a memoria respostas do banco, do e-mail, de tudo,
 * e deixaria o navegador mais pesado sem motivo. Entao os scripts so ficam
 * registrados enquanto uma captura roda: o Estudio "arma" no inicio (a
 * captura recarrega a pagina logo em seguida, e os hooks entram antes do
 * primeiro script do site) e "desarma" no fim.
 *
 * Se o Estudio fechar no meio, a aba dele sai de `estudios` e, quando nao
 * sobra nenhum, o registro vai embora junto.
 */
const IDS = ['xtr-hooks', 'xtr-bridge'];
const K_ESTUDIOS = 'bg.estudiosArmados';

// A ordem importa: cada arquivo usa o que os anteriores publicaram em
// window.__XTR__, e bridge.js (que responde ao Estudio) entra por ultimo.
const ARQUIVOS_MAIN = ['src/content/hooks.js'];
const ARQUIVOS_ISOLATED = [
  'src/content/scan.js',
  'src/content/scroll.js',
  'src/content/design-tokens.js',
  'src/content/design-patterns.js',
  'src/content/bridge.js'
];

const SCRIPTS = [
  {
    id: 'xtr-hooks', js: ARQUIVOS_MAIN, world: 'MAIN',
    matches: ['http://*/*', 'https://*/*'], runAt: 'document_start',
    allFrames: true, persistAcrossSessions: false
  },
  {
    id: 'xtr-bridge', js: ARQUIVOS_ISOLATED, world: 'ISOLATED',
    matches: ['http://*/*', 'https://*/*'], runAt: 'document_start',
    allFrames: true, persistAcrossSessions: false
  }
];

async function estudios() {
  try { return (await chrome.storage.session.get(K_ESTUDIOS))[K_ESTUDIOS] || []; } catch { return []; }
}

async function armar(tabEstudio) {
  const lista = new Set(await estudios());
  if (tabEstudio != null) lista.add(tabEstudio);
  await chrome.storage.session.set({ [K_ESTUDIOS]: [...lista] });
  const ja = await chrome.scripting.getRegisteredContentScripts({ ids: IDS });
  if (ja.length === IDS.length) return;
  if (ja.length) await chrome.scripting.unregisterContentScripts({ ids: ja.map((s) => s.id) });
  await chrome.scripting.registerContentScripts(SCRIPTS);
}

async function desarmar(tabEstudio) {
  if (tabEstudio != null) {
    const lista = (await estudios()).filter((t) => t !== tabEstudio);
    await chrome.storage.session.set({ [K_ESTUDIOS]: lista });
    if (lista.length) return; // outro Estudio ainda esta capturando
  } else {
    await chrome.storage.session.remove(K_ESTUDIOS).catch(() => {});
  }
  const ja = await chrome.scripting.getRegisteredContentScripts({ ids: IDS });
  if (ja.length) await chrome.scripting.unregisterContentScripts({ ids: ja.map((s) => s.id) });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await estudios()).includes(tabId)) desarmar(tabId).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => { desarmar().catch(() => {}); });

// So paginas da propria extensao (o Estudio) mandam comandos para ca. Content
// script tambem fala com o runtime, e ele vive dentro de paginas de terceiros.
function daExtensao(sender) {
  return sender && sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.ns !== 'xtr-bg') return false;
  if (!daExtensao(sender)) {
    sendResponse({ ok: false, error: 'origem nao autorizada' });
    return false;
  }
  const tabEstudio = sender.tab ? sender.tab.id : null;
  (async () => {
    try {
      if (msg.type === 'inject') {
        // O Estudio pede injecao sob demanda para abas que ja estavam abertas
        // antes da captura comecar (perfil sem recarregar).
        if (!Number.isInteger(msg.tabId)) return sendResponse({ ok: false, error: 'aba invalida' });
        await chrome.scripting.executeScript({
          target: { tabId: msg.tabId, allFrames: false },
          files: ARQUIVOS_MAIN,
          world: 'MAIN',
          injectImmediately: true
        }).catch(() => {});
        await chrome.scripting.executeScript({
          target: { tabId: msg.tabId, allFrames: false },
          files: ARQUIVOS_ISOLATED,
          world: 'ISOLATED',
          injectImmediately: true
        }).catch(() => {});
        return sendResponse({ ok: true });
      }
      if (msg.type === 'armar') {
        await armar(tabEstudio);
        return sendResponse({ ok: true });
      }
      if (msg.type === 'desarmar') {
        await desarmar(tabEstudio);
        return sendResponse({ ok: true });
      }
      sendResponse({ ok: false, error: 'tipo desconhecido' });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
