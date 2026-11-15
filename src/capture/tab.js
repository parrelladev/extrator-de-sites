/* tab.js — conversa com a aba que esta sendo capturada. */

export function sendToTab(tabId, msg, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('a aba nao respondeu a tempo')), timeoutMs);
    chrome.tabs.sendMessage(tabId, { ns: 'xtr', ...msg }, (res) => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(res);
    });
  });
}

export async function ensureInjected(tabId) {
  try {
    const r = await sendToTab(tabId, { type: 'ping' }, 2500);
    if (r && r.ok) return true;
  } catch { /* precisa injetar */ }
  await chrome.runtime.sendMessage({ ns: 'xtr-bg', type: 'inject', tabId });
  await sleep(400);
  try {
    const r = await sendToTab(tabId, { type: 'ping' }, 4000);
    return !!(r && r.ok);
  } catch { return false; }
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function waitForLoad(tabId, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      resolve(false); // segue mesmo assim: sites 3D as vezes nunca ficam "complete"
    }, timeoutMs);

    function onUpd(id, info) {
      if (id !== tabId || info.status !== 'complete' || done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpd);
      resolve(true);
    }
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((t) => {
      if (!done && t && t.status === 'complete') {
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve(true);
      }
    }).catch(reject);
  });
}

export async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await sleep(300);
  await waitForLoad(tabId);
  await sleep(500);
}
