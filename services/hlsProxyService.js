'use strict';

const axios = require('axios');
const SecurityService = require('./securityService');

/**
 * Servicio para Proxy de HLS
 * Fase 7: Manifest Principal, Variantes, Segmentos y Reescritura
 */
class HlsProxyService {
  /**
   * Reescribe un manifiesto HLS (.m3u8).
   * Parsea el texto y reemplaza las URLs de variantes (.m3u8) y segmentos (.ts, .m4s) 
   * por URLs seguras y temporales apuntando a nuestro servidor proxy.
   * 
   * @param {string} manifestContent - Contenido del .m3u8 original
   * @param {string} baseUrl - URL base para resolver URLs relativas en el manifest original
   * @param {string} serverHost - Dominio de nuestro servidor (ej: req.get('host'))
   * @param {string} protocol - http o https
   * @param {string} referer - Referer original para pasar a los segmentos
   */
  static rewriteManifest(manifestContent, baseUrl, serverHost, protocol, referer) {
    const lines = manifestContent.split('\n');
    let rewritten = [];
    const base = new URL(baseUrl);

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Ignorar líneas vacías o de comentario que no sean URIs
      if (!line || line.startsWith('#')) {
        // Algunas etiquetas de HLS tienen URLs adentro, como #EXT-X-STREAM-INF: URI="...", 
        // pero normalmente en m3u8 las URIs de los segmentos o variantes van en la siguiente línea sola.
        // Hay una excepción: #EXT-X-MEDIA:TYPE=AUDIO,URI="..."
        if (line.startsWith('#EXT-X-MEDIA:')) {
            line = line.replace(/URI="(.*?)"/g, (match, uri) => {
                const fullUrl = new URL(uri, base).href;
                const token = SecurityService.generateToken(fullUrl, '0.0.0.0', 21600);
                const proxyUrl = `${protocol}://${serverHost}/v/${token}?referer=${encodeURIComponent(referer)}`;
                return `URI="${proxyUrl}"`;
            });
        }
        rewritten.push(line);
        continue;
      }

      // Si es una línea que no empieza con #, es un enlace a una variante o a un segmento
      try {
        const fullUrl = new URL(line, base).href;
        // Dependiendo de la extensión, lo mandamos a /v/ (manifest) o /s/ (segment)
        const isManifest = fullUrl.includes('.m3u8') || fullUrl.includes('.txt');
        const endpoint = isManifest ? '/v/' : '/s/';
        
        // Generamos un token seguro para esta URL
        const token = SecurityService.generateToken(fullUrl, '0.0.0.0', 21600);
        
        const proxyUrl = `${protocol}://${serverHost}${endpoint}${token}?referer=${encodeURIComponent(referer)}`;
        rewritten.push(proxyUrl);
      } catch (err) {
        // En caso de error parseando URL, devolvemos la línea original
        rewritten.push(line);
      }
    }

    return rewritten.join('\n');
  }

  /**
   * Obtiene el manifiesto desde el servidor original
   */
  static async fetchManifest(url, referer) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };
    if (referer) {
      headers['Referer'] = referer;
      headers['Origin'] = new URL(referer).origin;
    }

    try {
      const response = await axios.get(url, {
        headers,
        timeout: 10000,
        responseType: 'text', // Los manifiestos son texto plano
        // httpsAgent: getAgent(), // Usar si se requiere bypass de certificados o proxy
      });
      return { content: response.data, finalUrl: response.request.res.responseUrl || url };
    } catch (err) {
      throw new Error(`Failed to fetch manifest: ${err.message}`);
    }
  }

  /**
   * Obtiene el flujo binario de un segmento
   */
  static async streamSegment(url, referer, res) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };
    if (referer) {
      headers['Referer'] = referer;
      headers['Origin'] = new URL(referer).origin;
    }

    try {
      const response = await axios({
        method: 'get',
        url: url,
        headers,
        responseType: 'stream',
        timeout: 15000,
      });

      // Transferir encabezados importantes
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      // Cache-Control para que los segmentos se guarden en caché (Fase 5 - CDN compatibilidad)
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      // Hacer pipe directo (stream) para minimizar consumo de memoria (Fase 9 - Bajo consumo CPU/Ancho de banda)
      response.data.pipe(res);
      
      response.data.on('error', (err) => {
        console.error('[HLS Stream Error]', err.message);
        res.end();
      });

    } catch (err) {
      console.error('[HLS Fetch Error]', err.message);
      if (!res.headersSent) {
         res.status(502).end();
      }
    }
  }
}

module.exports = HlsProxyService;
