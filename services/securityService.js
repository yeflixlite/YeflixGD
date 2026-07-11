'use strict';

const crypto = require('crypto');

// Secret key for AES encryption (must be 32 bytes for aes-256-gcm).
const SECRET_KEY = process.env.SECRET_KEY ? Buffer.from(process.env.SECRET_KEY.padEnd(32, '0').substring(0, 32)) : Buffer.from('YeflixSuperSecretKeyForProxy32bt'.substring(0, 32));
const ALGORITHM = 'aes-256-gcm';

/**
 * Servicio de Seguridad (Tokens, HMAC, Encryption)
 * Actualizado a AES-GCM para ser compatible con Web Crypto API (Cloudflare Workers)
 */
class SecurityService {
  /**
   * Genera un token encriptado que contiene la URL destino y su expiración.
   * Compatible 1:1 con decryptToken() en cloudflare-worker.js
   */
  static generateToken(targetUrl, ip = '0.0.0.0', ttl = 21600) {
    const payload = JSON.stringify({
      u: targetUrl,
      e: Math.floor(Date.now() / 1000) + ttl
    });

    // En AES-GCM el IV debe ser preferiblemente de 12 bytes
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
    
    let encrypted = cipher.update(payload, 'utf8');
    let finalBuffer = cipher.final();
    let authTag = cipher.getAuthTag(); // 16 bytes auth tag en Node.js

    // Web Crypto API adjunta automáticamente el AuthTag al final del ciphertext.
    // En Node debemos combinarlos manualmente para que Cloudflare lo pueda leer.
    const webCryptoCiphertext = Buffer.concat([encrypted, finalBuffer, authTag]);
    
    // El token es el IV (12 bytes) + el Ciphertext con AuthTag (Web Crypto Standard)
    const combined = Buffer.concat([iv, webCryptoCiphertext]);
    
    return combined.toString('base64url');
  }

  static validateToken(base64UrlToken, currentIp = '0.0.0.0') {
    // Si necesitas validar en Vercel, deberás separar el iv (12b), authTag (16b) y encrypted
    throw new Error("Validación delegada a Cloudflare Worker para ahorrar ancho de banda.");
  }

  static isPublicHttpUrl(url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      if (parsed.hostname.match(/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/)) return false;
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = SecurityService;
