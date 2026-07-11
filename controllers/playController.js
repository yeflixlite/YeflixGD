/**
 * ============================================================
 *  controllers/playController.js
 *  Orquesta la detección del proveedor y llama al servicio
 *  correcto para obtener el enlace real del video.
 *  JSON response endpoint.
 * ============================================================
 */

'use strict';

const { detectProvider }   = require('../utils/urlDetector');

/** Mapa proveedor → servicio HTTP (Lazy loaded inside handler) */
let HTTP_SERVICE_MAP = null;

function getServiceMap() {
  if (HTTP_SERVICE_MAP) return HTTP_SERVICE_MAP;
  
  // Lazy require to avoid crashes on Vercel/Serverless
  HTTP_SERVICE_MAP = {
    doodstream  : require('../services/doodstream'),
    streamtape  : require('../services/streamtape'),
    streamwish  : require('../services/streamwish'),
    hgcloud     : require('../services/streamwish'),
    vidhide     : require('../services/vidhide'),
    filemoon    : require('../services/filemoon'),
    voe         : require('../services/voe'),
    dailymotion : require('../services/dailymotion'),
    earvids     : require('../services/earvids'),
    direct      : require('../services/generic'),
    unknown     : require('../services/generic'),
  };
  return HTTP_SERVICE_MAP;
}

/** Mapa proveedor → servicio HTTP */
async function playHandler(req, res, next) {
  try {
    const { url, mode = 'auto' } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Parámetro "url" requerido.' });
    }

    let decodedUrl;
    try {
      decodedUrl = decodeURIComponent(url);
      new URL(decodedUrl);
    } catch {
      return res.status(400).json({ error: 'La URL proporcionada no es válida.' });
    }

    const serviceMap = getServiceMap();
    const provider = detectProvider(decodedUrl);

    console.log(`\n[Play] Proveedor detectado: ${provider} → ${decodedUrl}`);

    let result = null;
    let method = null;

    // MODO AUTO o HTTP: En Vercel solo permitimos HTTP por límite de recursos.
    // Puppeteer fue removido para versión 100% gratuita Vercel.
    const service = serviceMap[provider] || require('../services/generic');
    result = await service.extract(decodedUrl);
    method = 'http';

    // ── Proxy HLS con Tokens (Fase 6 y 7) ──────────────────────
    const SecurityService = require('../services/securityService');
    const token = SecurityService.generateToken(result.videoUrl, '0.0.0.0', 21600); // 6 horas TTL
    
    // Devolvemos la URL del manifiesto protegido dirigida al Cloudflare Worker
    const workerHost = process.env.WORKER_URL || 'TU-WORKER.tusubdominio.workers.dev';
    const proxyUrl = `https://${workerHost}/v/${token}?referer=${encodeURIComponent(result.referer || '')}`;

    return res.json({
      videoUrl : result.videoUrl,
      proxyUrl,
      type     : result.type,
      provider,
      method,
    });

  } catch (err) {
    console.error('[Play Error]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { playHandler };
