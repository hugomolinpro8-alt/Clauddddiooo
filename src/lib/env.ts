/** Vrai en développement local (localhost) : jamais sur claude.ai. */
export const IS_LOCAL = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
