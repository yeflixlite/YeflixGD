'use strict';

const { Router } = require('express');
const SecurityService = require('../services/securityService');
const HlsProxyService = require('../services/hlsProxyService');

const router = Router();

/**
 * Proxy HLS Manifest (/v/:token)
 * 1. Valida el token HMAC + Expiry.
 * 2. Valida la URL con UrlGuard.
 * 3. Descarga el manifiesto original.
 * 4. Reescribe las URIs internas hacia /s/:token o /v/:token.
 * 5. Devuelve el manifiesto reescrito.
 */
router.get('/v/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const referer = req.query.referer || '';
    
    // 1. Validar Token (IP validation disabled for Vercel dynamic IPs, can pass req.ip if needed)
    const targetUrl = SecurityService.validateToken(token, '0.0.0.0');

    // 2. UrlGuard
    if (!SecurityService.isPublicHttpUrl(targetUrl)) {
      return res.status(403).send('Forbidden: Invalid URL');
    }

    // 3. Obtener Manifiesto
    const { content, finalUrl } = await HlsProxyService.fetchManifest(targetUrl, referer);

    // 4. Reescribir Manifiesto
    const serverHost = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol; // Importante en Vercel
    const rewritten = HlsProxyService.rewriteManifest(content, finalUrl, serverHost, protocol, referer);

    // 5. Devolver
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);
  } catch (err) {
    console.error('[Manifest Proxy Error]', err.message);
    res.status(500).send('Error loading manifest');
  }
});

/**
 * Proxy HLS Segment (/s/:token)
 * 1. Valida el token HMAC + Expiry.
 * 2. Valida la URL con UrlGuard.
 * 3. Inicia un stream binario (pipe) desde la CDN hacia el cliente.
 */
router.get('/s/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const referer = req.query.referer || '';
    
    const targetUrl = SecurityService.validateToken(token, '0.0.0.0');

    if (!SecurityService.isPublicHttpUrl(targetUrl)) {
      return res.status(403).send('Forbidden: Invalid URL');
    }

    // Stream directo
    await HlsProxyService.streamSegment(targetUrl, referer, res);
  } catch (err) {
    console.error('[Segment Proxy Error]', err.message);
    res.status(500).send('Error loading segment');
  }
});

module.exports = router;
