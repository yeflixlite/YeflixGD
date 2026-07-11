/**
 * ============================================================
 *  services/doodstream.js
 *  Extrae el enlace de video real de Doodstream usando Puppeteer.
 *  Doodstream bloquea todas las peticiones HTTP directas (403),
 *  por lo que se intercepta la petición de video desde el navegador.
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

/** Convierte cualquier URL de Doodstream a la forma /e/<id> */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(d|e|f|v)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Doodstream no encontrado en la URL.');
  return match[2];
}

function randomStr(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function extract(url) {
  const id = normalizeUrl(url);
  const u = new URL(url);
  
  // Espejos limpios de Doodstream (ordenados por probabilidad de éxito)
  const CLEAN_MIRRORS = ['playmogo.com', 'dood.re', 'dood.pm', 'dood.la', 'doodstream.com'];
  const uniqueHosts = [...new Set([u.host, ...CLEAN_MIRRORS])];

  console.log(`[Doodstream] 🔍 Intentando extracción rápida por HTTP (Paralelo)...`);

  const tryHost = async (host) => {
      const embedUrl = `https://${host}/e/${id}`;
      try {
          const response = await fetchWithRetry(embedUrl, {
              referer: 'https://google.com/',
              timeout: 2500 // Tiempo agresivo para no retrasar Puppeteer
          }, 1);

          const html = response.data;
          if (html.includes('/pass_md5/') && !html.includes('Just a moment...')) {
              const passMatch = html.match(/\/pass_md5\/([^'"]+)/);
              if (passMatch) {
                  const passUrl = `https://${host}${passMatch[0]}`;
                  const passRes = await fetchWithRetry(passUrl, {
                      referer: embedUrl,
                      timeout: 3000
                  }, 1);

                  const baseUrl = passRes.data;
                  if (baseUrl && baseUrl.trim().startsWith('http')) {
                      const tokenPart = passMatch[1].split('/').pop();
                      return {
                          videoUrl: `${baseUrl.trim()}${randomStr(10)}?token=${tokenPart}&expiry=${Date.now()}`,
                          type: 'mp4',
                          referer: embedUrl,
                          method: 'http_mirror'
                      };
                  }
              }
          }
      } catch (e) {}
      throw new Error('Mirror falló');
  };

  try {
      // Intentamos todos en paralelo. El primero que responda gana.
      const result = await Promise.any(uniqueHosts.map(h => tryHost(h)));
      console.log(`[Doodstream] ✅ ¡ÉXITO HTTP!`);
      return result;
  } catch (e) {
      console.log(`[Doodstream] 🛡️ HTTP falló. Usando Puppeteer...`);
  }

  // Fallback a Puppeteer fue removido
  throw new Error('[Doodstream] Extracción HTTP falló y Puppeteer está deshabilitado en este entorno.');
}

module.exports = { extract };

