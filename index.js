'use strict'

const fp = require('fastify-plugin')
const Express = require('express')
const kMiddlewares = Symbol('fastify-express-middlewares')

function fastifyExpress (fastify, options, next) {
  const {
    expressHook = 'onRequest',
    createProxyHandler
  } = options

  const routerOptions = fastify.initialConfig.routerOptions || {}
  const ignoreDuplicateSlashes = routerOptions.ignoreDuplicateSlashes ?? fastify.initialConfig.ignoreDuplicateSlashes
  const useSemicolonDelimiter = routerOptions.useSemicolonDelimiter ?? fastify.initialConfig.useSemicolonDelimiter

  fastify.decorate('use', use)
  fastify[kMiddlewares] = []
  fastify.decorate('express', Express())
  fastify.express.disable('x-powered-by')

  fastify
    .addHook(expressHook, enhanceRequest)
    .addHook(expressHook, runConnect)
    .addHook('onRegister', onRegister)

  function use (path, fn) {
    const prefix = encodeMountPath(this.prefix)
    if (typeof path === 'string') {
      path = prefixMountPath(path, prefix)
    } else if (Array.isArray(path) && path.length > 0 && typeof path[0] !== 'function') {
      path = path.map(p => prefixMountPath(p, prefix))
    } else if (path instanceof RegExp && prefix.length > 0) {
      path = prefixRegExp(path, prefix)
    }
    this[kMiddlewares].push([path, fn])
    if (fn == null) {
      this.express.use(path)
    } else {
      this.express.use(path, fn)
    }
    return this
  }

  function enhanceRequest (req, reply, next) {
    // Allow attaching custom Proxy handlers to Express req
    if (typeof createProxyHandler === 'function') {
      req.raw = new Proxy(req.raw, createProxyHandler(req))
    }

    const { url } = req.raw
    req.raw.originalUrl = url

    const normalizedUrl = normalizeUrl(url, {
      ignoreDuplicateSlashes,
      useSemicolonDelimiter
    })

    if (normalizedUrl === null) {
      const error = new Error('Invalid URL')
      error.statusCode = 400
      next(error)
      return
    }

    req.raw.url = normalizedUrl
    req.raw.id = req.id
    req.raw.hostname = req.hostname
    req.raw.ip = req.ip
    req.raw.ips = req.ips
    req.raw.log = req.log
    reply.raw.log = req.log

    let replySent = false
    reply.raw.send = function send (...args) {
      if (replySent) {
        return
      }

      replySent = true
      // Restore req.raw.url to its original value https://github.com/fastify/fastify-express/issues/11
      req.raw.url = normalizedUrl
      return reply.send.apply(reply, args)
    }

    // backward compatibility for body-parser
    if (req.body) {
      req.raw.body = req.body
    }
    // backward compatibility for cookie-parser
    if (req.cookies) {
      req.raw.cookies = req.cookies
    }

    // ** Request **
    Object.defineProperty(req.raw, 'protocol', {
      get () {
        return req.protocol
      }
    })

    // ** Response **
    Object.defineProperty(reply.raw, 'headersSent', {
      get () { return replySent },
      configurable: true
    })

    next()
  }

  function runConnect (req, reply, next) {
    if (this[kMiddlewares].length > 0) {
      for (const [headerName, headerValue] of Object.entries(reply.getHeaders())) {
        reply.raw.setHeader(headerName, headerValue)
      }

      this.express(req.raw, reply.raw, next)
    } else {
      next()
    }
  }

  function onRegister (instance) {
    const middlewares = instance[kMiddlewares].slice()
    instance[kMiddlewares] = middlewares.slice()
    instance.decorate('express', Express())
    instance.express.disable('x-powered-by')
    instance.decorate('use', use)
    for (const [path, fn] of middlewares) {
      if (fn == null) {
        instance.express.use(path)
      } else {
        instance.express.use(path, fn)
      }
    }
  }

  next()
}

function normalizeUrl (url, options) {
  const {
    ignoreDuplicateSlashes,
    useSemicolonDelimiter
  } = options

  // Match find-my-way's absolute-form handling before normalizing the path.
  const originFormUrl = getPathFromAbsoluteUrl(url)
  if (originFormUrl === null) {
    return null
  }

  // Split off the query string before decoding, as find-my-way does, so that
  // Express decodes it only once, as Fastify does.
  const { path, query } = splitPathAndQuery(originFormUrl, useSemicolonDelimiter)

  // Decode the path the way find-my-way does before routing: `%25` stays
  // encoded, so a literal `%` is not decoded a second time when Express
  // decodes route parameters.
  let decodedPath
  try {
    decodedPath = decodeURI(path.replaceAll('%25', '%2525'))
    // The query string is passed on undecoded, but malformed percent-encoding
    // in it is still rejected, as it was when the whole URL was decoded.
    decodeURI(query)
  } catch {
    return null
  }

  const normalizedPath = ignoreDuplicateSlashes ? removeDuplicateSlashes(decodedPath) : decodedPath

  return encodeParseurlFallbackChars(normalizedPath + query)
}

// Express reads req.url with parseurl, which hands a URL containing any of
// these characters to the legacy url.parse(). That parser rewrites `\` to `/`,
// so Express would match mount paths against a different path from the one
// Fastify routed. Percent-encoding them keeps parseurl on its fast path.
const PARSEURL_FALLBACK_CHARS = /[\t\n\f\r #\u00a0\ufeff]/g

function encodeParseurlFallbackChars (url) {
  return url.replace(PARSEURL_FALLBACK_CHARS, encodeURIComponent)
}

// Spell a mount path the way normalizeUrl() spells the request path, so that
// it means what the same string means as a Fastify route: find-my-way also
// stores a literal `%` in a route as `%25`.
function encodeMountPath (path) {
  return encodeParseurlFallbackChars(path.replaceAll('%', '%25'))
}

function getPathFromAbsoluteUrl (url) {
  const scheme = /^https?:\/\//i.exec(url)
  if (scheme === null) {
    return url
  }

  const authorityStart = scheme[0].length
  const pathStart = url.indexOf('/', authorityStart)
  const queryStart = url.indexOf('?', authorityStart)
  const fragmentStart = url.indexOf('#', authorityStart)

  let authorityEnd = url.length
  if (pathStart !== -1) {
    authorityEnd = pathStart
  }
  if (queryStart !== -1 && queryStart < authorityEnd) {
    authorityEnd = queryStart
  }

  if (fragmentStart !== -1 || authorityEnd === authorityStart || !URL.canParse(url)) {
    return null
  }

  if (authorityEnd === url.length) {
    return '/'
  }
  if (authorityEnd === queryStart) {
    return '/' + url.slice(queryStart)
  }
  return url.slice(pathStart)
}

function splitPathAndQuery (url, useSemicolonDelimiter) {
  // Like find-my-way, end the path at the first `?` or `#`, or at the first
  // `;` when useSemicolonDelimiter is set.
  const queryIndex = url.search(useSemicolonDelimiter ? /[?#;]/ : /[?#]/)

  if (queryIndex === -1) {
    return { path: url, query: '' }
  }

  return {
    path: url.slice(0, queryIndex),
    query: `?${url.slice(queryIndex + 1)}`
  }
}

function removeDuplicateSlashes (path) {
  return path.replace(/\/{2,}/g, '/')
}

function prefixMountPath (p, prefix) {
  if (typeof p === 'string') {
    return prefix + (p === '/' && prefix.length > 0 ? '' : encodeMountPath(p))
  }
  if (p instanceof RegExp && prefix.length > 0) {
    return prefixRegExp(p, prefix)
  }
  /* c8 ignore next */
  return p
}

function prefixRegExp (re, prefix) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inner = re.source.replace(/(?:^|(?<=\|))\^/g, '')
  const hasAnchor = inner !== re.source
  const source = hasAnchor
    ? '^' + escapedPrefix + '(?:' + inner + ')'
    : escapedPrefix + '(?:' + re.source + ')'
  return new RegExp(source, re.flags)
}

module.exports = fp(fastifyExpress, {
  fastify: '5.x',
  name: '@fastify/express'
})
module.exports.default = fastifyExpress
module.exports.fastifyExpress = fastifyExpress
