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
    // With ignoreDuplicateSlashes the router collapses repeated slashes in the
    // routes it registers and in the request URL (see normalizeUrl), so mount
    // paths must be collapsed too or they can never match.
    const prefix = ignoreDuplicateSlashes ? removeDuplicateSlashes(this.prefix) : this.prefix
    if (typeof path === 'string') {
      path = prefixMountPath(path, prefix, ignoreDuplicateSlashes)
    } else if (Array.isArray(path) && path.length > 0 && typeof path[0] !== 'function') {
      path = path.flatMap(p => prefixMountPath(p, prefix, ignoreDuplicateSlashes))
    } else if (path instanceof RegExp) {
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

function removeDuplicateSlashes (path) {
  return path.replace(/\/{2,}/g, '/')
}

function joinPrefix (prefix, path) {
  // Match Fastify's own route-prefix join so the Express mount path always
  // lines up with the path find-my-way serves. Both `prefix` and `path` may
  // or may not carry a leading/trailing slash; naively concatenating them
  // yields a mount path that can never match (e.g. `/api//secret` from
  // `/api/` + `/secret`, or `/apisecret` from `/api` + `secret`), letting
  // auth middlewares be silently skipped.
  if ((path === '/' && prefix.length > 0) || (path[0] === '/' && prefix.endsWith('/'))) {
    // The prefix already supplies the separator; drop the path's leading slash.
    path = path.slice(1)
  } else if (path[0] !== '/' && !prefix.endsWith('/')) {
    // A mount path with no leading slash would otherwise glue onto the prefix
    // (`/api` + `secret` => `/apisecret`) and never match a slash-led route.
    // Fastify serves a slashless route at exactly that glued path, though, so
    // mount both spellings.
    return prefix.length > 0 ? [prefix + '/' + path, prefix + path] : '/' + path
  }
  return prefix + path
}

function prefixMountPath (p, prefix, ignoreDuplicateSlashes) {
  if (typeof p === 'string') {
    const joined = joinPrefix(prefix, p)
    if (!ignoreDuplicateSlashes) {
      return joined
    }
    return Array.isArray(joined) ? joined.map(removeDuplicateSlashes) : removeDuplicateSlashes(joined)
  }
  if (p instanceof RegExp) {
    return prefixRegExp(p, prefix)
  }
  /* c8 ignore next */
  return p
}

const ESCAPE_REGEXP = /[.*+?^${}()|[\]\\]/g

// Translate a Fastify route prefix (e.g. `/tenant/:tenantId`, `/a::b`,
// `/user/:id(\\d+)`) into a RegExp source that matches the concrete URLs
// Fastify routes to the plugin. Escaping the prefix wholesale treated `:param`
// as literal text, so RegExp-mounted middleware was skipped for ordinary URLs,
// bypassing auth (GHSA-84w6-xrf3-f8q8).
//
// find-my-way has already routed the request into this plugin, so a prefix
// segment holding a parameter (`:id`, `:id(\\d+)`, `:from-:to`) only needs to
// match one whole segment. Copying a parameter regex into the pattern instead
// would change what its `^` and `$` mean (find-my-way tests it against one
// segment), could make the pattern invalid under the `u` or `v` flag, and lets
// several parameters in one segment backtrack.
function prefixToRegExpSource (prefix) {
  let result = ''
  let segment = ''
  let dynamic = false
  let depth = 0

  const flush = () => {
    const source = dynamic ? '[^\\/]*' : segment.replace(ESCAPE_REGEXP, '\\$&')
    segment = ''
    dynamic = false
    return source
  }

  for (let i = 0; i < prefix.length; i++) {
    const char = prefix[i]

    if (depth > 0) {
      // Skip a parameter regex; find-my-way keeps it within one segment.
      if (char === '\\') {
        i++
      } else if (char === '(') {
        depth++
      } else if (char === ')') {
        depth--
      }
    } else if (char === '/') {
      result += flush() + '\\/'
    } else if (char === ':' && prefix[i + 1] === ':') {
      // `::` is an escaped literal colon in find-my-way.
      segment += ':'
      i++
    } else if (char === ':') {
      dynamic = true
    } else if (char === '(' && dynamic) {
      depth = 1
    } else {
      segment += char
    }
  }

  return result + flush()
}

function prefixRegExp (re, prefix) {
  // Express calls exec() on the mount RegExp directly. With `g` or `y` the
  // match state carries over in lastIndex, so every other request would skip
  // the middleware.
  const flags = re.flags.replace(/[gy]/g, '')
  if (prefix.length === 0) {
    return flags === re.flags ? re : new RegExp(re.source, flags)
  }

  // Join the prefix to the pattern with an optional single slash, so there is
  // exactly one slash at the boundary whether or not the prefix ends with one
  // and whether or not the pattern (or one of its alternatives) starts with
  // one, however that slash is spelled (`\/`, `[/]`, `\x2f`, inside a group).
  // The slash is optional and lazy: a pattern that can match the empty string
  // (`/^(?!\/public)/`) must stop right after the prefix, since Express skips
  // a mount whose match ends in the middle of a path segment.
  const mountPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const escapedPrefix = prefixToRegExpSource(mountPrefix)
  const boundary = escapedPrefix + '\\/??'

  // Every route of a prefixed plugin starts with the prefix, so the pattern is
  // matched against the rest of the path, as Express does for a mounted
  // router: `^` in the original pattern now means the end of the prefix, and
  // an unanchored alternative may match anywhere after it. A `^` leading a
  // top-level alternative anchors that alternative; any other `^` (e.g. inside
  // a group) becomes a lookbehind for the same position.
  const alternatives = rewriteAnchors(re.source, flags.includes('v'), '(?<=^' + boundary + ')')
  let source = '^' + boundary + '(?:' + alternatives
    .map(a => a.anchored ? a.source : '[\\s\\S]*?(?:' + a.source + ')')
    .join('|') + ')'

  // A route at the prefix itself (`/api` for `get('/')`) leaves nothing after
  // the prefix, where a mounted Express router would test the pattern against
  // '/'. Match the bare prefix when the pattern matches '/'.
  const root = new RegExp(re.source, flags).exec('/')
  if (root !== null && root[0].length <= 1) {
    source = '^' + escapedPrefix + '(?=\\/?$)|' + source
  }
  return new RegExp(source, flags)
}

// Split a RegExp source into its top-level alternatives, stripping the `^`
// that leads an alternative (reported as `anchored`) and replacing every other
// `^` assertion with `anchor`. Escapes and character classes are skipped, so
// `\^`, `[^/]` and `[|]` are left alone.
function rewriteAnchors (source, unicodeSets, anchor) {
  const alternatives = []
  let current = { source: '', anchored: false }
  let depth = 0
  let classDepth = 0

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (char === '\\') {
      current.source += char + source[i + 1]
      i++
    } else if (classDepth > 0) {
      // With the `v` flag, classes nest (`[[a-z]--[aeiou]]`).
      if (char === '[' && unicodeSets) {
        classDepth++
      } else if (char === ']') {
        classDepth--
      }
      current.source += char
    } else if (char === '[') {
      classDepth = 1
      current.source += char
    } else if (char === '(') {
      depth++
      current.source += char
    } else if (char === ')') {
      depth--
      current.source += char
    } else if (char === '|' && depth === 0) {
      alternatives.push(current)
      current = { source: '', anchored: false }
    } else if (char === '^') {
      if (depth === 0 && current.source === '' && !current.anchored) {
        current.anchored = true
      } else {
        current.source += anchor
      }
    } else {
      current.source += char
    }
  }

  alternatives.push(current)
  return alternatives
}

module.exports = fp(fastifyExpress, {
  fastify: '5.x',
  name: '@fastify/express'
})
module.exports.default = fastifyExpress
module.exports.fastifyExpress = fastifyExpress
