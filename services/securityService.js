'use strict';

const crypto = require('crypto');

// Secret key for AES encryption (must be 32 bytes for aes-256-cbc). In production use process.env.SECRET_KEY
const SECRET_KEY = process.env.SECRET_KEY ? Buffer.from(process.env.SECRET_KEY.padEnd(32, '0').substring(0, 32)) : Buffer.from('YeflixSuperSecretKeyForProxy32bt'.substring(0, 32));
const ALGORITHM = 'aes-256-cbc';

/**
 * Servicio de Seguridad (Tokens, HMAC, Encryption)
 * Basado en la Fase 6 de la arquitectura propuesta.
 */
class SecurityService {
  /**
   * Genera un token encriptado que contiene la URL destino y su expiración.
   * @param {string} targetUrl - URL real de la CDN (m3u8 o ts)
   * @param {string} ip - IP del usuario (opcional para Vercel)
   * @param {number} ttl - Tiempo de vida en segundos (por defecto 6 horas para videos largos)
   * @returns {string} - Token encriptado en base64url
   */
  static generateToken(targetUrl, ip = '0.0.0.0', ttl = 21600) {
    const payload = JSON.stringify({
      u: targetUrl,
      i: ip,
      e: Math.floor(Date.now() / 1000) + ttl
    });

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
    
    let encrypted = cipher.update(payload, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Retornamos IV + Encrypted Data (url safe)
    const token = `${iv.toString('hex')}.${encrypted}`;
    return Buffer.from(token).toString('base64url');
  }

  /**
   * Valida un token y devuelve el payload desencriptado.
   * @param {string} base64UrlToken 
   * @param {string} currentIp 
   * @returns {object} - { url: string }
   * @throws {Error} Si el token es inválido o expiró
   */
  static validateToken(base64UrlToken, currentIp = '0.0.0.0') {
    try {
      const decodedToken = Buffer.from(base64UrlToken, 'base64url').toString('utf8');
      const [ivHex, encrypted] = decodedToken.split('.');
      
      if (!ivHex || !encrypted) throw new Error('Token format invalid');

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
      
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      const payload = JSON.parse(decrypted);

      // Validate Expiry
      if (Math.floor(Date.now() / 1000) > payload.e) {
        throw new Error('Token expired');
      }

      return { url: payload.u };
    } catch (err) {
      throw new Error(`Token validation failed: ${err.message}`);
    }
  }

  /**
   * UrlGuard: Protege contra SSRF validando que la URL sea pública.
   * @param {string} url 
   */
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
