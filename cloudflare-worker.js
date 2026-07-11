/**
 * ============================================================
 *  Cloudflare Worker - HLS Proxy (Ancho de Banda Ilimitado)
 *  Despliega este código en Cloudflare Workers.
 * ============================================================
 */

const SECRET_KEY = "YeflixSuperSecretKeyForProxy32bt"; // Misma clave que en Vercel

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname; // /v/ o /s/
    
    // Solo procesamos rutas /v/ (manifest) o /s/ (segment)
    if (!path.startsWith('/v/') && !path.startsWith('/s/')) {
      return new Response("Yeflix HLS Proxy Worker Running OK", { status: 200 });
    }

    const token = path.substring(3); // quitamos /v/ o /s/
    const referer = url.searchParams.get('referer') || '';

    try {
      // 1. Desencriptar el Token
      const targetUrl = await decryptToken(token, SECRET_KEY);

      if (!targetUrl.startsWith('http')) {
        return new Response("URL Invalida", { status: 403 });
      }

      // 2. Si es un Segmento (/s/) -> Hacemos Stream Binario Directo
      if (path.startsWith('/s/')) {
        return await proxySegment(targetUrl, referer);
      }

      // 3. Si es un Manifiesto (/v/) -> Lo descargamos y reescribimos
      if (path.startsWith('/v/')) {
        return await proxyManifest(targetUrl, referer, url.origin);
      }

    } catch (err) {
      return new Response("Token Invalido o Error Interno: " + err.message, { status: 403 });
    }
  }
};

// --- Funciones del Proxy ---

async function proxySegment(targetUrl, referer) {
  const headers = new Headers();
  headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  if (referer) {
    headers.set('Referer', referer);
    headers.set('Origin', new URL(referer).origin);
  }

  const response = await fetch(targetUrl, { headers });
  
  // Devolvemos la respuesta exacta (stream) añadiendo CORS
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Cache-Control', 'public, max-age=31536000');
  return newResponse;
}

async function proxyManifest(targetUrl, referer, workerOrigin) {
  const headers = new Headers();
  headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  if (referer) {
    headers.set('Referer', referer);
    headers.set('Origin', new URL(referer).origin);
  }

  const response = await fetch(targetUrl, { headers });
  let text = await response.text();
  const finalUrl = response.url || targetUrl;
  const baseUrl = new URL(finalUrl);

  // Reescribir M3U8
  const lines = text.split('\n');
  const rewritten = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) {
      rewritten.push(line);
      continue;
    }
    
    // Es una URL a un segmento o sub-manifiesto
    try {
      const fullUrl = new URL(line, baseUrl).href;
      const isManifest = fullUrl.includes('.m3u8') || fullUrl.includes('.txt');
      const endpoint = isManifest ? '/v/' : '/s/';
      
      // Encriptamos la URL para el siguiente hop
      const nextToken = await encryptToken(fullUrl, SECRET_KEY);
      const proxyUrl = `${workerOrigin}${endpoint}${nextToken}?referer=${encodeURIComponent(referer)}`;
      
      rewritten.push(proxyUrl);
    } catch(e) {
      rewritten.push(line);
    }
  }

  const newResponse = new Response(rewritten.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }
  });
  return newResponse;
}

// --- Utilidades Criptográficas (Web Crypto API para Cloudflare) ---
// Usamos AES-GCM porque es más amigable en Web Crypto API que CBC, 
// así que cambiaremos el token en Vercel a AES-GCM para que coincida.

async function getCryptoKey(secretStr) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secretStr.substring(0, 32).padEnd(32, '0')),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return keyMaterial;
}

// Formato de token: Base64( iv(12) + ciphertext )
// (Nota: Base64UrlSafe)

async function encryptToken(urlStr, secretStr) {
  const key = await getCryptoKey(secretStr);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const payload = JSON.stringify({ u: urlStr, e: Math.floor(Date.now()/1000) + 21600 });
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(payload)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decryptToken(tokenStr, secretStr) {
  const base64 = tokenStr.replace(/-/g, '+').replace(/_/g, '/');
  const binaryString = atob(base64);
  const combined = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    combined[i] = binaryString.charCodeAt(i);
  }

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const key = await getCryptoKey(secretStr);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    data
  );

  const dec = new TextDecoder();
  const payload = JSON.parse(dec.decode(decrypted));
  
  if (payload.e < Math.floor(Date.now()/1000)) {
    throw new Error('Expired');
  }
  return payload.u;
}
