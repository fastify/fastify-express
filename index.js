'use strict'

const fp = require('fastify-plugin')
const Express = require('express')
const parseUrl = require('parseurl')
const { parse, pathToRegexp } = require('path-to-regexp')
const kMiddlewares = Symbol('fastify-express-middlewares')
const kDynamicMountMatchers = Symbol('fastify-express-dynamic-mount-matchers')

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
  fastify[kDynamicMountMatchers] = []
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

    if (caseSensitive === false) {
      // The request path is lowercased to mirror the router (see normalizeUrl),
      // so a RegExp mount path, and the plugin prefix rewritten into it, must
      // match case-insensitively or it would never match an uppercase spelling.
      path = Array.isArray(path) ? path.map(foldRegExp) : foldRegExp(path)
    }
    this[kMiddlewares].push([path, fn])
    this[kDynamicMountMatchers].push(...compileDynamicMountMatchers(path))
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
    // An empty segment can match a Fastify route while the Express mount on the
    // same dynamic pattern is skipped, bypassing its middleware. Reject such
    // ambiguous requests. Only a route with parameters or a wildcard can take
    // the empty segment: a static route (e.g. `/users/` next to a
    // `/users/:id` mount) is not covered by the mount, as in Express.
    if (isDynamicRoute(req.routeOptions.url) && hasAmbiguousDynamicMount(this[kDynamicMountMatchers], req.raw)) {
      const error = new Error('Invalid route parameter')
      error.statusCode = 400
      next(error)
      return
    }

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
    const dynamicMountMatchers = instance[kDynamicMountMatchers].slice()
    instance[kMiddlewares] = middlewares.slice()
    instance[kDynamicMountMatchers] = dynamicMountMatchers.slice()
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

function compileDynamicMountMatchers (path) {
  const paths = Array.isArray(path) ? path : [path]
  const matchers = []

  for (const mountPath of paths) {
    if (mountPath instanceof RegExp) {
      // A RegExp mount cannot be modelled as a string, so keep the pattern and
      // detect ambiguity by filling empty segments (see hasAmbiguousDynamicMount).
      matchers.push({
        express: new RegExp(mountPath.source, mountPath.flags.replace(/[gy]/g, '')),
        permissive: null
      })
      continue
    }

    if (typeof mountPath !== 'string') {
      continue
    }

    // Express strips trailing slashes from string mounts before matching.
    const loosened = mountPath === '/' ? mountPath : mountPath.replace(/\/+$/, '')
    const compiled = compileTokens(parse(loosened).tokens)
    if (compiled.dynamic) {
      matchers.push({
        express: pathToRegexp(loosened, { end: false }).regexp,
        permissive: new RegExp(`^(?:${compiled.source})(?:\\/$)?(?=\\/|$)`, 'i')
      })
    }
  }

  return matchers
}

function compileTokens (tokens) {
  let source = ''
  let dynamic = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'text') {
      source += token.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (token.type === 'param' || token.type === 'wildcard') {
      // Exclude the following literal's delimiter so adjacent parameters in a
      // single segment cannot overlap and cause catastrophic backtracking.
      const next = tokens[i + 1]
      const delimiter = next && next.type === 'text' ? next.value[0] : ''
      const excluded = delimiter && delimiter !== '/' ? delimiter.replace(/[-\]\\^]/g, '\\$&') : ''
      source += token.type === 'wildcard'
        ? (excluded ? `[^${excluded}]*` : '.*')
        : `[^${excluded}/]*`
      dynamic = true
    } else if (token.type === 'group') {
      const group = compileTokens(token.tokens)
      source += `(?:${group.source})?`
      dynamic ||= group.dynamic
    }
  }

  return { source, dynamic }
}

function isDynamicRoute (url) {
  return url !== undefined && /[:*]/.test(url)
}

function hasAmbiguousDynamicMount (matchers, rawRequest) {
  const path = parseUrl(rawRequest).pathname
  return matchers.some(matcher => {
    if (matcher.permissive === null) {
      // RegExp mount: ambiguous when the pattern misses only because a segment
      // is empty, i.e. it matches once the empty segments are filled.
      return !matcher.express.test(path) && matcher.express.test(fillEmptySegments(path))
    }
    return !matcher.express.test(path) && matcher.permissive.test(path)
  })
}

function fillEmptySegments (path) {
  return path
    .split('/')
    .map((segment, index) => index > 0 && segment.trim().length === 0 ? 'a' : segment)
    .join('/')
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

function escapePrefix (prefix) {
  return prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  // a mount whose match ends in the middle of a path segment. As for a mounted
  // Express router, the prefix ends at a slash or at the end of the path.
  const mountPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const escapedPrefix = escapePrefix(mountPrefix)
  const boundary = escapedPrefix + '(?=\\/|$)\\/??'

  // Every route of a prefixed plugin starts with the prefix, so the pattern is
  // matched against the rest of the path, as Express does for a mounted
  // router. Express only runs a RegExp mount whose match starts the path, so
  // every alternative is matched from the end of the prefix, whether or not it
  // starts with `^`; any other `^` (e.g. inside a group) becomes a lookbehind
  // for the same position. Searching for an unanchored alternative anywhere
  // after the prefix would also take time quadratic in the length of the path.
  const pattern = rewriteAnchors(re.source, flags.includes('v'), '(?<=^' + boundary + ')')
  let source = '^' + boundary + '(?:' + pattern + ')'

  // A route at the prefix itself (`/api` for `get('/')`) leaves nothing after
  // the prefix, where a mounted Express router would test the pattern against
  // '/'. Match the bare prefix when the pattern matches '/'.
  const root = new RegExp(re.source, flags).exec('/')
  if (root !== null && root[0].length <= 1) {
    source = '^' + escapedPrefix + '(?=\\/?$)|' + source
  }
  return new RegExp(source, flags)
}

// Rewrite the `^` assertions of a RegExp source matched from the end of the
// prefix: the `^` that leads a top-level alternative is dropped, and every
// other `^` is replaced with `anchor`. Escapes and character classes are
// skipped, so `\^`, `[^/]` and `[|]` are left alone.
function rewriteAnchors (source, unicodeSets, anchor) {
  let result = ''
  let leading = true
  let depth = 0
  let classDepth = 0

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    let startsAlternative = false

    if (char === '\\') {
      result += char + source[i + 1]
      i++
    } else if (classDepth > 0) {
      // With the `v` flag, classes nest (`[[a-z]--[aeiou]]`).
      if (char === '[' && unicodeSets) {
        classDepth++
      } else if (char === ']') {
        classDepth--
      }
      result += char
    } else if (char === '[') {
      classDepth = 1
      result += char
    } else if (char === '(') {
      depth++
      result += char
    } else if (char === ')') {
      depth--
      result += char
    } else if (char === '|' && depth === 0) {
      result += char
      startsAlternative = true
    } else if (char === '^') {
      if (!leading) {
        result += anchor
      }
    } else {
      result += char
    }
    leading = startsAlternative
  }

  return result
}

module.exports = fp(fastifyExpress, {
  fastify: '5.x',
  name: '@fastify/express'
})
module.exports.default = fastifyExpress
module.exports.fastifyExpress = fastifyExpress
