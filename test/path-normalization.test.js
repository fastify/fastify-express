'use strict'

const { test } = require('node:test')
const fastify = require('fastify')

const expressPlugin = require('../index')

test('ignoreDuplicateSlashes does not bypass path-scoped middleware', async t => {
  t.plan(3)

  const instance = fastify({
    routerOptions: {
      ignoreDuplicateSlashes: true
    }
  })

  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  instance.use('/admin', function (req, res, next) {
    middlewareCalls++

    if (req.headers.authorization !== 'Bearer admin-secret-token') {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'Forbidden by Express middleware' }))
      return
    }

    next()
  })

  instance.get('/admin/dashboard', async () => {
    return { secret: 'classified' }
  })

  const address = await instance.listen({ port: 0 })

  const normalRequest = await fetch(address + '/admin/dashboard')
  t.assert.deepStrictEqual(normalRequest.status, 403)

  const bypassAttempt = await fetch(address + '//admin/dashboard')
  t.assert.deepStrictEqual(bypassAttempt.status, 403)

  t.assert.deepStrictEqual(middlewareCalls, 2)
})

test('useSemicolonDelimiter does not bypass path-scoped middleware', async t => {
  t.plan(5)

  const instance = fastify({
    routerOptions: {
      useSemicolonDelimiter: true
    }
  })

  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  instance.use('/admin', function (req, res, next) {
    middlewareCalls++

    if (req.headers.authorization !== 'Bearer admin-secret-token') {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'Forbidden by Express middleware' }))
      return
    }

    next()
  })

  instance.get('/admin', async () => {
    return { secret: 'classified' }
  })

  const address = await instance.listen({ port: 0 })

  const normalRequest = await fetch(address + '/admin')
  t.assert.deepStrictEqual(normalRequest.status, 403)

  const withQueryString = await fetch(address + '/admin?foo=bar')
  t.assert.deepStrictEqual(withQueryString.status, 403)

  const withSemicolonInQuery = await fetch(address + '/admin?foo=bar;baz=1')
  t.assert.deepStrictEqual(withSemicolonInQuery.status, 403)

  const bypassAttempt = await fetch(address + '/admin;bypass')
  t.assert.deepStrictEqual(bypassAttempt.status, 403)

  t.assert.deepStrictEqual(middlewareCalls, 4)
})

test('case-insensitive routing does not bypass path-scoped middleware', async t => {
  const instance = fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0
  let handlerCalls = 0
  function requireToken (req, res, next) {
    middlewareCalls++
    if (req.headers.authorization === 'Bearer admin-secret-token') return next()
    res.statusCode = 401
    res.end('blocked')
  }

  let middlewareUrl
  instance.use('/api/keys', (req, res, next) => {
    middlewareUrl = req.baseUrl
    requireToken(req, res, next)
  })
  instance.get('/api/keys', async req => {
    handlerCalls++
    return { url: req.url, rawUrl: req.raw.url, originalUrl: req.raw.originalUrl }
  })
  instance.use('/kiosk', requireToken)
  instance.get('/kiosk/config', async () => {
    handlerCalls++
    return { secret: 'classified' }
  })

  const address = await instance.listen({ port: 0 })
  for (const path of [
    '/api/keys',
    '/API/KEYS',
    '/api/%E2%84%AAeys',
    '/api/%E2%84%AAeys?Key=%E2%84%AA',
    '/kiosk/config',
    '/%E2%84%AAiosk/config'
  ]) {
    const response = await fetch(address + path)
    t.assert.strictEqual(response.status, 401, path)
    t.assert.strictEqual(await response.text(), 'blocked', path)
  }
  t.assert.strictEqual(middlewareCalls, 6)
  t.assert.strictEqual(handlerCalls, 0)

  const response = await fetch(address + '/api/%E2%84%AAeys?Key=%E2%84%AA', {
    headers: { authorization: 'Bearer admin-secret-token' }
  })
  t.assert.strictEqual(response.status, 200)
  // Middleware matched on the folded path; the handler sees the original spelling.
  t.assert.strictEqual(middlewareUrl, '/api/keys')
  t.assert.deepStrictEqual(await response.json(), {
    url: '/api/Keys?Key=K',
    rawUrl: '/api/Keys?Key=K',
    originalUrl: '/api/%E2%84%AAeys?Key=%E2%84%AA'
  })
  t.assert.strictEqual(middlewareCalls, 7)
  t.assert.strictEqual(handlerCalls, 1)
})

test('case-sensitive routing does not fold the Kelvin sign', async t => {
  const instance = fastify({ routerOptions: { caseSensitive: true } })
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0
  instance.use('/api/keys', (req, res) => {
    middlewareCalls++
    res.statusCode = 401
    res.end('blocked')
  })
  instance.get('/api/keys', async () => ({ secret: 'classified' }))

  const address = await instance.listen({ port: 0 })
  const normal = await fetch(address + '/api/keys')
  t.assert.strictEqual(normal.status, 401)

  const kelvin = await fetch(address + '/api/%E2%84%AAeys')
  t.assert.strictEqual(kelvin.status, 404)
  t.assert.strictEqual(middlewareCalls, 1)
})

test('case-insensitive routing does not bypass RegExp middleware with uppercase prefixes or patterns', async t => {
  const instance = fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0
  function block (_req, res) {
    middlewareCalls++
    res.statusCode = 401
    res.end('blocked')
  }

  // Already case-insensitive patterns are kept as they are.
  instance.use(/^\/root/i, block)
  instance.get('/root', async () => ({ secret: 'classified' }))

  await instance.register(async function (admin) {
    admin.use(/^\/secret/, block)
    admin.use([/^\/Keys/], block)
    admin.get('/secret', async () => ({ secret: 'classified' }))
    admin.get('/keys', async () => ({ secret: 'classified' }))
    admin.get('/public', async () => ({ ok: true }))
  }, { prefix: '/Admin' })

  for (const path of ['/ROOT', '/admin/secret', '/ADMIN/SECRET', '/Admin/Secret', '/admin/keys', '/admin/%E2%84%AAeys']) {
    middlewareCalls = 0
    const response = await instance.inject(path)
    t.assert.strictEqual(response.statusCode, 401, path)
    t.assert.strictEqual(middlewareCalls, 1, path)
  }

  middlewareCalls = 0
  const open = await instance.inject('/ADMIN/PUBLIC')
  t.assert.strictEqual(open.statusCode, 200)
  t.assert.strictEqual(middlewareCalls, 0)
})

test('case-insensitive routing keeps the original URL spelling for route handlers', async t => {
  const instance = fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareSeen
  instance.use('/files', (req, _res, next) => {
    middlewareSeen = { url: req.url, originalUrl: req.originalUrl }
    next()
  })
  instance.get('/files/:name', async req => ({ url: req.url, rawUrl: req.raw.url, params: req.params }))

  const address = await instance.listen({ port: 0 })
  const response = await fetch(address + '/Files/ReadMe.TXT?Sig=AbC')
  t.assert.strictEqual(response.status, 200)
  t.assert.deepStrictEqual(await response.json(), {
    url: '/Files/ReadMe.TXT?Sig=AbC',
    rawUrl: '/Files/ReadMe.TXT?Sig=AbC',
    params: { name: 'ReadMe.TXT' }
  })
  t.assert.deepStrictEqual(middlewareSeen, { url: '/readme.txt?Sig=AbC', originalUrl: '/Files/ReadMe.TXT?Sig=AbC' })
})

test('case-insensitive routing keeps the original URL spelling without any middleware', async t => {
  const instance = fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())

  await instance.register(expressPlugin)
  // Without any middleware Express does not run, and the URL must be restored all the same.
  instance.get('/Other/:name', async req => ({ url: req.url, params: req.params }))

  const response = await instance.inject('/OTHER/Name?Q=A')
  t.assert.deepStrictEqual(response.json(), { url: '/OTHER/Name?Q=A', params: { name: 'Name' } })
})
