import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBlock } from '../../src/lib/guard.js';

const json = (status, body = '{}', url = 'https://www.vinted.fr/api/v2/x') => ({ status, url, contentType: 'application/json', bodyText: body });

test('réponse normale : pas de blocage', () => {
  assert.equal(detectBlock(json(200, '{"items":[]}')), null);
  assert.equal(detectBlock(json(404, '{"code":"not_found"}')), null);
});

test('403 / 429 / 401 déclenchent un arrêt', () => {
  assert.equal(detectBlock(json(429)).code, 'http_429');
  assert.equal(detectBlock(json(403)).code, 'http_403');
  assert.equal(detectBlock(json(401)).code, 'http_401');
});

test('captcha DataDome / Cloudflare / reCAPTCHA détectés même en 200', () => {
  assert.equal(detectBlock(json(200, '{"url":"https://geo.captcha-delivery.com/captcha/?x"}')).code, 'captcha');
  assert.equal(detectBlock({ status: 200, contentType: 'text/html', bodyText: '<html><title>Just a moment...</title>' }).code, 'captcha');
  assert.equal(detectBlock(json(200, '<div class="g-recaptcha">')).code, 'captcha');
});

test('redirection vers une vérification', () => {
  assert.equal(detectBlock(json(200, '{}', 'https://www.vinted.fr/verification/phone')).code, 'verification');
});

test('HTML à la place de JSON = suspect', () => {
  assert.equal(detectBlock({ status: 200, url: 'https://www.vinted.fr/api/v2/x', contentType: 'text/html; charset=utf-8', bodyText: '<html></html>' }).code, 'html_inattendu');
});

test('message d’erreur JSON parlant de vérification', () => {
  assert.equal(detectBlock(json(400, '{"message":"Please complete verification"}')).code, 'verification');
});

test('réponse absente', () => {
  assert.equal(detectBlock(undefined).code, 'reponse_invalide');
});
