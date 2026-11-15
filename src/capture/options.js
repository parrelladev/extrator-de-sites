/* options.js — as opcoes da captura e seus valores padrao. */

export const DEFAULTS = {
  depth: 0,
  maxPages: 25,
  maxResources: 4000,
  concurrency: 8,
  maxFileMB: 80,
  scroll: true,
  scrollPasses: 1,
  scrollDwell: 420,
  scrollStep: 0.7,
  repousoMs: 45000,      // teto da fase de repouso, depois da rolagem
  repousoQuietoMs: 4000, // quietude de rede exigida para dar a pagina por pronta
  hover: false,
  reload: true,
  deepScanJs: true,
  includeMedia: true,
  skipAnalytics: true,
  saveSnapshot: true,
  apiCache: true,
  blockServiceWorker: true,
  verboseRuntime: false,
  crossOriginAssets: true,
  designSystem: true,
  focarAba: true,       // traz a aba para frente enquanto rola (ver autoscroll)
  plataforma: 'unix'   // 'windows' | 'unix' — decide qual atalho e gerado
};
