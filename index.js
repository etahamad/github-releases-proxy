// URL to fetch upstream assets from
const ORIGIN_URL = 'https://github.com/PotatoDevices'

// Whether to cache assets from GitHub
// Disable to conserve Workers cache quota
const USE_CACHE = false

// Browser cache TTL, in seconds
const CACHE_TTL = 5259488 // 2 months

// Regex patterns for allowed CORS origins
const CORS_ALLOWED_ORIGINS = [
  /^potatodevices\.etahamad\.dev$/,
  /^android-webinstall-etahamad\.vercel\.app$/,
  /^android-webinstall-git-[a-z0-9\-_/]-etahamad\.vercel\.app$/,
  /^android-webinstall-[a-z0-9]+-etahamad\.vercel\.app$/,
]

class RequestError extends Error {
  constructor(status, message) {
    super(`HTTP ${status}: ${message}`)
    this.status = status
    this.messageText = message
    this.name = this.constructor.name
  }
}

function validateCors(origin) {
  let originUrl = new URL(origin)
  for (let pattern of CORS_ALLOWED_ORIGINS) {
    if (pattern.test(originUrl.host)) {
      return true
    }
  }

  return false
}

function parseRequest(request) {
  if (request.method !== 'GET') {
    throw new RequestError(405, 'Invalid request method')
  }

  // Validate CORS, if necessary
  let origin = request.headers.get('Origin')
  if (origin !== null && !validateCors(origin)) {
    throw new RequestError(403, 'Origin not allowed')
  }

  let reqUrl = new URL(request.url)
  let reqParts = reqUrl.pathname.split('/').slice(1)
  // repo, tag, filename
  if (reqParts.length !== 3) {
    throw new RequestError(404, 'Invalid request URL')
  }

  let [repo, tag, filename] = reqParts
  return {
    url: `${ORIGIN_URL}/${repo}/releases/download/${tag}/${filename}`,
    corsOrigin: origin,
  }
}

function modifyResponse(response) {
  response.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`)
}

async function respondAsset(request) {
  const cache = caches.default
  let { url, corsOrigin } = parseRequest(request)

  let originResp = undefined
  if (USE_CACHE) {
    // Try cache first
    originResp = await cache.match(request)
  }
  if (originResp === undefined) {
    // Fetch from origin
    originResp = await fetch(url)

    if (USE_CACHE) {
      // Tee the stream for both the client and caching readers to use
      let bodies = originResp.body.tee()
      originResp = new Response(bodies[0], originResp)
      let cacheResp = new Response(bodies[1], originResp)

      // Set TTL for caching purposes
      modifyResponse(cacheResp)
      await cache.put(request, cacheResp)
    }
  }

  // Copy response and modify headers
  let clientResp = new Response(originResp.body, originResp)
  modifyResponse(clientResp)
  if (corsOrigin !== null) {
    clientResp.headers.set('Access-Control-Allow-Origin', corsOrigin)
  }

  return clientResp
}

async function handleRequest(request) {
  try {
    return await respondAsset(request)
  } catch (e) {
    // Handle RequestError exceptions with proper error responses
    if (e instanceof RequestError) {
      return new Response(e.messageText, {
        status: e.status,
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
      })
    } else {
      throw e
    }
  }
}

addEventListener('fetch', function (event) {
  let resp = handleRequest(event.request)
  return event.respondWith(resp)
})
