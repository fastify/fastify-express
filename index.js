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
  const caseSensitive = routerOptions.caseSensitive ?? fastify.initialConfig.caseSensitive

  fastify.decorate('use', use)
  fastify[kMiddlewares] = []
  fastify.decorate('express', Express())
  fastify.express.disable('x-powered-by')

  fastify
    .addHook(expressHook, enhanceRequest)
    .addHook(expressHook, runConnect)
    .addHook('onRegister', onRegister)

  function use (path, fn) {
    const prefix = this.prefix
    if (typeof path === 'string') {
      path = prefix + (path === '/' && prefix.length > 0 ? '' : path)
    } else if (Array.isArray(path) && path.length > 0 && typeof path[0] !== 'function') {
      path = path.map(p => prefixMountPath(p, prefix))
    } else if (path instanceof RegExp && prefix.length > 0) {
      path = prefixRegExp(path, prefix)
    }

    if (caseSensitive === false) {
      // The request path is lowercased to mirror the router (see normalizeUrl),
      // so a RegExp mount path, and the plugin prefix rewritten into it, must
      // match case-insensitively or it would never match an uppercase spelling.
      path = Array.isArray(path) ? path.map(foldRegExp) : foldRegExp(path)
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

    // With case-insensitive routing, Express matches path-scoped middleware on
    // a path folded the way find-my-way folds it. Route handlers get the
    // original spelling back once Express is done (see runConnect).
    req[kNormalizedUrl] = normalizedUrl
    req.raw.url = caseSensitive === false ? foldPath(normalizedUrl) : normalizedUrl
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

      this.express(req.raw, reply.raw, caseSensitive === false ? restoreUrl : next)
    } else if (caseSensitive === false) {
      restoreUrl()
    } else {
      next()
    }

    // Hand route handlers the URL in its original spelling (see enhanceRequest).
    function restoreUrl (err) {
      if (req.raw.url === foldPath(req[kNormalizedUrl])) {
        req.raw.url = req[kNormalizedUrl]
      }
      next(err)
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

  let decodedUrl
  try {
    decodedUrl = decodeURI(originFormUrl)
  } catch {
    return null
  }

  const { path, query } = splitPathAndQuery(decodedUrl, useSemicolonDelimiter)
  const normalizedPath = ignoreDuplicateSlashes ? removeDuplicateSlashes(path) : path

  return normalizedPath + query
}

const kNormalizedUrl = Symbol('fastify-express-normalized-url')

// Lowercase the path, not the query, as find-my-way does with caseSensitive: false.
function foldPath (url) {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1
    ? url.toLowerCase()
    : url.slice(0, queryIndex).toLowerCase() + url.slice(queryIndex)
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
  const queryIndex = url.indexOf('?')

  if (!useSemicolonDelimiter) {
    if (queryIndex === -1) {
      return { path: url, query: '' }
    }

    return {
      path: url.slice(0, queryIndex),
      query: url.slice(queryIndex)
    }
  }

  const semicolonIndex = url.indexOf(';')

  if (semicolonIndex === -1 || (queryIndex !== -1 && queryIndex < semicolonIndex)) {
    if (queryIndex === -1) {
      return { path: url, query: '' }
    }

    return {
      path: url.slice(0, queryIndex),
      query: url.slice(queryIndex)
    }
  }

  return {
    path: url.slice(0, semicolonIndex),
    query: `?${url.slice(semicolonIndex + 1)}`
  }
}

function foldRegExp (p) {
  return p instanceof RegExp && !p.flags.includes('i') ? new RegExp(p.source, p.flags + 'i') : p
}

function removeDuplicateSlashes (path) {
  return path.replace(/\/{2,}/g, '/')
}

function prefixMountPath (p, prefix) {
  if (typeof p === 'string') {
    return prefix + (p === '/' && prefix.length > 0 ? '' : p)
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
