/**
 * bridge.js — "Pont" injecté dans les onglets Vinted.
 *
 * Pourquoi un pont ? Pour utiliser VOTRE session déjà connectée sans jamais
 * manipuler de mot de passe : les requêtes partent de la page Vinted
 * elle-même, avec ses cookies, exactement comme quand vous cliquez.
 *
 * Ce script :
 *   1. exécute les requêtes demandées par le service worker (uniquement vers
 *      /api/ du même site) et renvoie la réponse brute ;
 *   2. surveille la page : si un captcha ou une vérification apparaît, il
 *      prévient immédiatement le service worker, qui arrête tout.
 *
 * Il ne clique sur rien, ne remplit aucun formulaire et ne touche jamais aux
 * captchas.
 */
(() => {
  // Évite une double installation si le script est injecté deux fois.
  if (window.__vdaBridgeInstalled) return;
  window.__vdaBridgeInstalled = true;

  const MAX_BODY = 500000; // on tronque les très grosses réponses

  /** Jeton anti-CSRF que Vinted place dans la page (nécessaire pour les écritures). */
  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || null;
  }

  async function doFetch({ method = 'GET', path, body }) {
    // Sécurité : uniquement des chemins relatifs vers l'API du site courant.
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
      return { error: 'chemin_refuse', message: `Chemin refusé : ${path}` };
    }
    const headers = { Accept: 'application/json, text/plain, */*' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      const csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    try {
      const res = await fetch(path, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return {
        status: res.status,
        url: res.url,
        contentType: res.headers.get('content-type') || '',
        bodyText: text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text,
      };
    } catch (e) {
      return { error: 'reseau', message: String(e?.message || e) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'VDA_PING') {
      sendResponse({ ok: true, host: location.host, hasCsrf: Boolean(getCsrfToken()) });
      return false;
    }
    if (msg?.type === 'VDA_FETCH') {
      doFetch(msg).then(sendResponse);
      return true; // réponse asynchrone
    }
    return false;
  });

  // --- Surveillance des captchas / vérifications dans la page --------------
  const CHALLENGE_SELECTORS = [
    'iframe[src*="captcha-delivery.com"]', // DataDome
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha.com"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '#challenge-form',
    '.g-recaptcha',
  ];
  let reported = false;

  function checkForChallenge() {
    if (reported) return;
    const hit = CHALLENGE_SELECTORS.find((sel) => document.querySelector(sel));
    const urlHit = /captcha|challenge|verif/i.test(location.pathname);
    if (hit || urlHit) {
      reported = true;
      chrome.runtime
        .sendMessage({
          type: 'VDA_CHALLENGE_DETECTED',
          detail: hit ? `élément ${hit}` : `URL ${location.pathname}`,
        })
        .catch(() => {});
    }
  }

  checkForChallenge();
  // On revérifie quand la page change, au plus une fois par seconde.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled || reported) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      checkForChallenge();
    }, 1000);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
