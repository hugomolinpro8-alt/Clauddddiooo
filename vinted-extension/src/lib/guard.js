/**
 * guard.js — Détection des blocages Vinted (fonctions pures).
 *
 * Principe NON NÉGOCIABLE : si Vinted montre le moindre signe de méfiance
 * (403, 429, captcha, page de vérification, session expirée), l'extension
 * s'arrête complètement et vous prévient. Elle n'essaie JAMAIS de contourner
 * ces protections : pas de nouvelle tentative, pas de changement d'en-têtes,
 * pas de résolution de captcha. C'est à vous de regarder ce qui se passe dans
 * votre navigateur, puis de relancer manuellement depuis la popup.
 */

/** Marqueurs textuels de pages de captcha / défi anti-bot connues. */
const CHALLENGE_PATTERNS = [
  /captcha-delivery\.com/i, // DataDome
  /geo\.captcha-delivery/i,
  /datadome/i,
  /g-recaptcha|recaptcha\/api/i,
  /hcaptcha\.com/i,
  /challenges\.cloudflare\.com|cf-challenge|cf_chl_/i,
  /<title>\s*just a moment/i,
  /turnstile/i,
];

/** Fragments d'URL indiquant une redirection vers une vérification. */
const VERIFICATION_URL_PATTERN = /captcha|challenge|verif|two[-_]?factor|2fa|security[-_]?check/i;

/**
 * Analyse une réponse HTTP renvoyée par le pont (content script).
 * @param {{status:number, url?:string, contentType?:string, bodyText?:string}} resp
 * @returns {null | {code:string, message:string}}  null = pas de blocage détecté
 */
export function detectBlock(resp) {
  if (!resp || typeof resp.status !== 'number') {
    return { code: 'reponse_invalide', message: 'Réponse vide ou illisible du pont Vinted.' };
  }
  const { status } = resp;
  const body = String(resp.bodyText || '').slice(0, 50000);
  const url = String(resp.url || '');

  if (status === 429) return { code: 'http_429', message: 'Vinted signale trop de requêtes (HTTP 429).' };
  if (status === 403) return { code: 'http_403', message: 'Vinted refuse la requête (HTTP 403).' };
  if (status === 401) return { code: 'http_401', message: 'Session expirée ou non connectée (HTTP 401).' };

  if (CHALLENGE_PATTERNS.some((re) => re.test(body))) {
    return { code: 'captcha', message: 'Un captcha / défi anti-bot a été détecté.' };
  }
  // Une URL finale différente contenant "captcha", "verif"... = redirection vers une vérification.
  try {
    const path = new URL(url).pathname + new URL(url).search;
    if (VERIFICATION_URL_PATTERN.test(path)) {
      return { code: 'verification', message: `Redirection vers une page de vérification (${path}).` };
    }
  } catch {
    /* URL absente : ignoré */
  }
  // On attend du JSON d'une API : du HTML veut souvent dire "page de défi".
  const ct = String(resp.contentType || '');
  if (status >= 200 && status < 300 && /text\/html/i.test(ct)) {
    return { code: 'html_inattendu', message: 'Vinted a renvoyé une page HTML au lieu de données (possible vérification).' };
  }
  // Certains messages d'erreur JSON parlent explicitement de vérification.
  if (/"(code|message|error)"\s*:\s*"[^"]*(verif|captcha|challenge)/i.test(body)) {
    return { code: 'verification', message: 'Vinted demande une vérification.' };
  }
  return null;
}

/** Nombre d'erreurs serveur (5xx / réseau) consécutives avant arrêt de prudence. */
export const MAX_CONSECUTIVE_ERRORS = 3;
