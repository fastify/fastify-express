'use strict'

// Original Fastify test/middlewares.test.js file

const { test } = require('node:test')
const fastify = require('fastify')
const fp = require('fastify-plugin')
const cors = require('cors')
const express = require('express')
const helmet = require('helmet')

const expressPlugin = require('../index')

test('use a middleware', async t => {
  t.plan(5)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register(expressPlugin)
    .after(() => {
      const useRes = instance.use(function (_req, _res, next) {
        t.assert.ok('middleware called')
        next()
      })

      t.assert.deepStrictEqual(useRes, instance)
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address)

  const responseText = await result.text()
  t.assert.deepStrictEqual(result.status, 200)
  t.assert.deepStrictEqual(result.headers.get('content-length'), '' + responseText.length)
  t.assert.deepStrictEqual(JSON.parse(responseText), { hello: 'world' })
})

test('use cors', async t => {
  t.plan(1)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register(expressPlugin)
    .after(() => {
      instance.use(cors())
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')
})

test('use helmet', async t => {
  t.plan(1)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register(expressPlugin)
    .after(() => {
      instance.use(helmet())
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.ok(result.headers.get('x-xss-protection'))
})

test('use helmet and cors', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register(expressPlugin)
    .after(() => {
      instance.use(cors())
      instance.use(helmet())
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address)

  t.assert.ok(result.headers.get('x-xss-protection'))
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')
})

test('use cors only on prefix', async t => {
  t.plan(1)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register((innerInstance) => {
    innerInstance.register(expressPlugin).after(() => {
      innerInstance.use('/', cors())
    })
    innerInstance.get('/', function (_request, reply) {
      reply.send({ hello: 'world' })
    })
  }, { prefix: '/prefix' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/prefix')

  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')
})

test('middlewares with prefix', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register(expressPlugin)
    .after(() => {
      instance.use(function (req, _res, next) {
        req.global = true
        next()
      })
      instance.use('', function (req, _res, next) {
        req.global2 = true
        next()
      })
      instance.use('/', function (req, _res, next) {
        req.root = true
        next()
      })
      instance.use('/prefix', function (req, _res, next) {
        req.prefixed = true
        next()
      })
      instance.use('/prefix/', function (req, _res, next) {
        req.slashed = true
        next()
      })
    })

  function handler (request, reply) {
    reply.send({
      prefixed: request.raw.prefixed,
      slashed: request.raw.slashed,
      global: request.raw.global,
      global2: request.raw.global2,
      root: request.raw.root
    })
  }

  instance.get('/', handler)
  instance.get('/prefix', handler)
  instance.get('/prefix/', handler)
  instance.get('/prefix/inner', handler)

  const address = await instance.listen({ port: 0 })

  await t.test('/', async t => {
    t.plan(1)

    const result = await fetch(address + '/')
    t.assert.deepStrictEqual(await result.json(), {
      global: true,
      global2: true,
      root: true
    })
  })

  await t.test('/prefix', async t => {
    t.plan(1)

    const result = await fetch(address + '/prefix')
    t.assert.deepStrictEqual(await result.json(), {
      prefixed: true,
      global: true,
      global2: true,
      root: true,
      slashed: true
    })
  })

  await t.test('/prefix/', async t => {
    t.plan(1)

    const result = await fetch(address + '/prefix/')
    t.assert.deepStrictEqual(await result.json(), {
      prefixed: true,
      slashed: true,
      global: true,
      global2: true,
      root: true
    })
  })

  await t.test('/prefix/inner', async t => {
    t.plan(1)

    const result = await fetch(address + '/prefix/inner')
    t.assert.deepStrictEqual(await result.json(), {
      prefixed: true,
      slashed: true,
      global: true,
      global2: true,
      root: true
    })
  })
})

test('should not double-prefix inherited middleware paths in child scopes', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  instance.use('/admin', function (req, res, next) {
    if (req.headers.authorization == null) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }

    next()
  })

  instance.get('/admin/root-data', async function () {
    return { data: 'root-secret' }
  })

  await instance.register(async function (child) {
    child.get('/secret', async function () {
      return { data: 'child-secret' }
    })
  }, { prefix: '/admin' })

  const address = await instance.listen({ port: 0 })

  const rootNoAuth = await fetch(address + '/admin/root-data')
  t.assert.deepStrictEqual(rootNoAuth.status, 403)

  const childNoAuth = await fetch(address + '/admin/secret')
  t.assert.deepStrictEqual(childNoAuth.status, 403)

  const childWithAuth = await fetch(address + '/admin/secret', {
    headers: {
      authorization: 'Bearer test'
    }
  })

  t.assert.deepStrictEqual(childWithAuth.status, 200)
  t.assert.deepStrictEqual(await childWithAuth.json(), { data: 'child-secret' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('array mount paths are rewritten with prefix', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (admin) {
    admin.use(['/private', '/settings'], function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    admin.get('/private', async () => {
      return { secret: 'admin-data' }
    })

    admin.get('/settings', async () => {
      return { settings: true }
    })
  }, { prefix: '/admin' })

  const address = await instance.listen({ port: 0 })

  const privateNoAuth = await fetch(address + '/admin/private')
  t.assert.deepStrictEqual(privateNoAuth.status, 403)

  const settingsNoAuth = await fetch(address + '/admin/settings')
  t.assert.deepStrictEqual(settingsNoAuth.status, 403)

  const privateWithAuth = await fetch(address + '/admin/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(privateWithAuth.status, 200)
  t.assert.deepStrictEqual(await privateWithAuth.json(), { secret: 'admin-data' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('regex mount paths are rewritten with prefix', async t => {
  t.plan(3)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (admin) {
    admin.use(/^\/private/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    admin.get('/private', async () => {
      return { secret: 'admin-data' }
    })
  }, { prefix: '/admin' })

  const address = await instance.listen({ port: 0 })

  const noAuth = await fetch(address + '/admin/private')
  t.assert.deepStrictEqual(noAuth.status, 403)

  const withAuth = await fetch(address + '/admin/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
  t.assert.deepStrictEqual(await withAuth.json(), { secret: 'admin-data' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('regex without anchor is rewritten with prefix', async t => {
  t.plan(3)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (admin) {
    admin.use(/\/private/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    admin.get('/private', async () => {
      return { secret: 'admin-data' }
    })
  }, { prefix: '/admin' })

  const address = await instance.listen({ port: 0 })

  const noAuth = await fetch(address + '/admin/private')
  t.assert.deepStrictEqual(noAuth.status, 403)

  const withAuth = await fetch(address + '/admin/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
  t.assert.deepStrictEqual(await withAuth.json(), { secret: 'admin-data' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('array with root slash is handled correctly with prefix', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalled = false

  await instance.register(async function (child) {
    child.use(['/', '/health'], function (_req, _res, next) {
      middlewareCalled = true
      next()
    })

    child.get('/health', async () => {
      return { ok: true }
    })
  }, { prefix: '/api' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/health')
  t.assert.deepStrictEqual(result.status, 200)
  t.assert.ok(middlewareCalled)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('array of middleware functions (no path) works in prefixed plugin', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalled = false

  await instance.register(async function (child) {
    child.use([function (_req, _res, next) {
      middlewareCalled = true
      next()
    }])

    child.get('/data', async () => {
      return { ok: true }
    })
  }, { prefix: '/api' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/data')
  t.assert.deepStrictEqual(result.status, 200)
  t.assert.ok(middlewareCalled)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('regex with alternation is fully rewritten with prefix', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (admin) {
    admin.use(/^\/private|^\/settings/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    admin.get('/private', async () => {
      return { secret: 'admin-data' }
    })

    admin.get('/settings', async () => {
      return { settings: true }
    })
  }, { prefix: '/admin' })

  const address = await instance.listen({ port: 0 })

  const privateNoAuth = await fetch(address + '/admin/private')
  t.assert.deepStrictEqual(privateNoAuth.status, 403)

  const settingsNoAuth = await fetch(address + '/admin/settings')
  t.assert.deepStrictEqual(settingsNoAuth.status, 403)

  const privateWithAuth = await fetch(address + '/admin/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(privateWithAuth.status, 200)
  t.assert.deepStrictEqual(await privateWithAuth.json(), { secret: 'admin-data' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-3wf5-7852-vcfq
test('mixed array of strings and regexes is rewritten with prefix', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (admin) {
    admin.use(['/private', /^\/settings/], function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    admin.get('/private', async () => {
      return { secret: 'admin-data' }
    })

    admin.get('/settings', async () => {
      return { settings: true }
    })
  }, { prefix: '/admin' })

  const address = await instance.listen({ port: 0 })

  const privateNoAuth = await fetch(address + '/admin/private')
  t.assert.deepStrictEqual(privateNoAuth.status, 403)

  const settingsNoAuth = await fetch(address + '/admin/settings')
  t.assert.deepStrictEqual(settingsNoAuth.status, 403)

  const privateWithAuth = await fetch(address + '/admin/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(privateWithAuth.status, 200)
  t.assert.deepStrictEqual(await privateWithAuth.json(), { secret: 'admin-data' })
})

test('res.end should block middleware execution', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())
  instance.register(expressPlugin)
    .after(() => {
      instance.use(function (_req, res) {
        res.send('hello')
      })

      instance.use(function () {
        t.assert.fail('we should not be here')
      })
    })

  instance.addHook('onRequest', (_req, _res, next) => {
    t.assert.ok('called')
    next()
  })

  instance.addHook('preHandler', () => {
    t.assert.fail('this should not be called')
  })

  instance.addHook('onSend', (_req, _reply, payload, next) => {
    t.assert.ok('called')
    next(null, payload)
  })

  instance.addHook('onResponse', (_request, _reply, next) => {
    t.assert.ok('called')
    next()
  })

  instance.get('/', function () {
    t.assert.fail('we should no be here')
  })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address)

  t.assert.deepStrictEqual(result.status, 200)

  t.assert.deepStrictEqual(await result.text(), 'hello')
})

test('Use a middleware inside a plugin after an encapsulated plugin', async t => {
  t.plan(3)
  const f = fastify()
  t.after(() => f.close())
  f.register(expressPlugin)

  f.register(function (instance, _opts, next) {
    instance.use(function (_req, _res, next) {
      t.assert.ok('first middleware called')
      next()
    })

    instance.get('/', function (_request, reply) {
      reply.send({ hello: 'world' })
    })

    next()
  })

  f.register(fp(function (instance, _opts, next) {
    instance.use(function (_req, _res, next) {
      t.assert.ok('second middleware called')
      next()
    })

    next()
  }))

  const address = await f.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.status, 200)

  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('middlewares should run in the order in which they are defined', async t => {
  t.plan(8)
  const f = fastify()
  t.after(() => f.close())
  f.register(expressPlugin)

  f.register(fp(function (instance, _opts, next) {
    instance.use(function (req, _res, next) {
      t.assert.deepStrictEqual(req.previous, undefined)
      req.previous = 1
      next()
    })

    instance.register(fp(function (i, _opts, next) {
      i.use(function (req, _res, next) {
        t.assert.deepStrictEqual(req.previous, 2)
        req.previous = 3
        next()
      })
      next()
    }))

    instance.use(function (req, _res, next) {
      t.assert.deepStrictEqual(req.previous, 1)
      req.previous = 2
      next()
    })

    next()
  }))

  f.register(function (instance, _opts, next) {
    instance.use(function (req, _res, next) {
      t.assert.deepStrictEqual(req.previous, 3)
      req.previous = 4
      next()
    })

    instance.get('/', function (request, reply) {
      t.assert.deepStrictEqual(request.raw.previous, 5)
      reply.send({ hello: 'world' })
    })

    instance.register(fp(function (i, _opts, next) {
      i.use(function (req, _res, next) {
        t.assert.deepStrictEqual(req.previous, 4)
        req.previous = 5
        next()
      })
      next()
    }))

    next()
  })

  const address = await f.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.status, 200)
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('middlewares for encoded paths', async t => {
  await t.test('decode the request url and run the middleware', async (t) => {
    await checkEncodedPath('/encoded', '/%65ncoded', t)
  })

  await t.test('does not double decode the url', async (t) => {
    await checkEncodedPath('/%65ncoded', '/%2565ncoded', t)
  })

  await t.test('handle the decoding for express handlers', async (t) => {
    t.plan(6)

    const routeUrl = '/express'
    const requestUrl = '/%65xpress'

    const instance = fastify()
    t.after(() => instance.close())

    instance.addHook('onSend', async function hook (request, reply, payload) {
      t.assert.deepStrictEqual(request.raw.url, routeUrl)
      t.assert.deepStrictEqual(request.raw.originalUrl, requestUrl)
      return payload
    })

    instance.addHook('onResponse', async function hook (request, reply) {
      t.assert.deepStrictEqual(request.raw.url, routeUrl)
      t.assert.deepStrictEqual(request.raw.originalUrl, requestUrl)
    })

    await instance.register(expressPlugin)

    // Register the express-like middleware
    instance.use(routeUrl, function (req, _res, next) {
      req.slashedByExpress = true
      next()
    })

    // Register an express Router with an express handler
    const innerRouter = express.Router()
    innerRouter.get(routeUrl, function (req, res) {
      res.send({ slashedByExpress: req.slashedByExpress })
    })
    instance.use(innerRouter)

    const address = await instance.listen({ port: 0 })

    const response = await fetch(address + requestUrl)
    const body = await response.json()
    t.assert.ok(response.ok)
    t.assert.deepStrictEqual(body, { slashedByExpress: true })
  })
})

async function checkEncodedPath (routeUrl, requestUrl, t) {
  t.plan(6)

  const instance = fastify()
  t.after(() => instance.close())

  instance.addHook('onSend', async function hook (request, reply, payload) {
    t.assert.deepStrictEqual(request.raw.url, routeUrl)
    t.assert.deepStrictEqual(request.raw.originalUrl, requestUrl)
    return payload
  })

  instance.addHook('onResponse', async function hook (request, reply) {
    t.assert.deepStrictEqual(request.raw.url, routeUrl)
    t.assert.deepStrictEqual(request.raw.originalUrl, requestUrl)
  })

  await instance.register(expressPlugin)

  // Register the express-like middleware
  instance.use(routeUrl, function (req, _res, next) {
    req.slashed = true
    next()
  })

  // ... with a Fastify route handler
  instance.get(routeUrl, (request, reply) => {
    reply.send({ slashed: request.raw.slashed, })
  })

  const address = await instance.listen({ port: 0 })

  const response = await fetch(address + requestUrl)
  const body = await response.json()
  t.assert.ok(response.ok)
  t.assert.deepStrictEqual(body, { slashed: true })
}

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// A parameterized prefix must not be treated as literal text when rewriting a
// RegExp mount path, otherwise the middleware is skipped and auth is bypassed.
test('regex mount paths are rewritten with a parameterized prefix', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (tenant) {
    tenant.use(/^\/private/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    tenant.get('/private', async () => {
      return { secret: 'tenant-data' }
    })
  }, { prefix: '/tenant/:tenantId' })

  const address = await instance.listen({ port: 0 })

  // A non-empty parameter value must reach the middleware.
  const noAuth = await fetch(address + '/tenant/acme/private')
  t.assert.deepStrictEqual(noAuth.status, 403)

  // An empty parameter is still routed by Fastify, so the middleware must run.
  const emptyParam = await fetch(address + '/tenant//private')
  t.assert.deepStrictEqual(emptyParam.status, 403)

  const withAuth = await fetch(address + '/tenant/acme/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
  t.assert.deepStrictEqual(await withAuth.json(), { secret: 'tenant-data' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
test('regex without anchor is rewritten with a parameterized prefix', async t => {
  t.plan(3)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (tenant) {
    tenant.use(/\/private/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    tenant.get('/private', async () => {
      return { secret: 'tenant-data' }
    })
  }, { prefix: '/tenant/:tenantId' })

  const address = await instance.listen({ port: 0 })

  const noAuth = await fetch(address + '/tenant/acme/private')
  t.assert.deepStrictEqual(noAuth.status, 403)

  const withAuth = await fetch(address + '/tenant/acme/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
  t.assert.deepStrictEqual(await withAuth.json(), { secret: 'tenant-data' })
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// An escaped colon (`::`) in a prefix maps to a single `:` in the request URL.
test('regex mount paths with an escaped-colon prefix', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (child) {
    child.use(/^\/x/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    child.get('/x', async () => {
      return { ok: true }
    })
  }, { prefix: '/a::b' })

  const address = await instance.listen({ port: 0 })

  const noAuth = await fetch(address + '/a:b/x')
  t.assert.deepStrictEqual(noAuth.status, 403)

  const withAuth = await fetch(address + '/a:b/x', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// A custom-regex parameter keeps its constraint when rewriting a RegExp mount.
test('regex mount paths with a custom-regex parameter prefix', async t => {
  t.plan(3)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (user) {
    user.use(/^\/x/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    user.get('/x', async () => {
      return { ok: true }
    })
  }, { prefix: '/user/:id(\\d+)' })

  const address = await instance.listen({ port: 0 })

  // The constraint is honoured: a non-digit param is not routed by Fastify.
  const nonDigit = await fetch(address + '/user/abc/x')
  t.assert.deepStrictEqual(nonDigit.status, 404)

  const noAuth = await fetch(address + '/user/123/x')
  t.assert.deepStrictEqual(noAuth.status, 403)

  const withAuth = await fetch(address + '/user/123/x', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// find-my-way ignores `^` and `$` around a parameter regex, so they must not
// end up as anchors in the middle of the rewritten mount path.
test('regex mount paths with an anchored custom-regex parameter in the prefix', async t => {
  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0
  await instance.register(async function (user) {
    user.use(/^\/x/, function (_req, res) {
      middlewareCalls++
      res.statusCode = 403
      res.end('blocked by middleware')
    })

    user.get('/x', async () => ({ ok: true }))
  }, { prefix: '/user/:id(^\\d+$)' })

  t.assert.deepStrictEqual((await instance.inject('/user/abc/x')).statusCode, 404)
  t.assert.deepStrictEqual((await instance.inject('/user/123/x')).statusCode, 403)
  t.assert.deepStrictEqual(middlewareCalls, 1)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// A parameter immediately followed by a static fragment is still matched.
test('regex mount paths with a parameter followed by a static fragment', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (order) {
    order.use(/^\/x/, function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    order.get('/x', async () => {
      return { ok: true }
    })
  }, { prefix: '/orders/:id-edit' })

  const address = await instance.listen({ port: 0 })

  const noAuth = await fetch(address + '/orders/123-edit/x')
  t.assert.deepStrictEqual(noAuth.status, 403)

  const withAuth = await fetch(address + '/orders/123-edit/x', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(withAuth.status, 200)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// Array mount paths containing a RegExp are rewritten with a parameterized prefix.
test('array mount paths are rewritten with a parameterized prefix', async t => {
  t.plan(4)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  await instance.register(async function (tenant) {
    tenant.use(['/private', /^\/settings/], function (req, res, next) {
      if (req.headers.authorization !== 'Bearer secret') {
        res.statusCode = 403
        res.end('blocked by middleware')
        return
      }
      next()
    })

    tenant.get('/private', async () => {
      return { secret: 'tenant-data' }
    })

    tenant.get('/settings', async () => {
      return { settings: true }
    })
  }, { prefix: '/tenant/:tenantId' })

  const address = await instance.listen({ port: 0 })

  const privateNoAuth = await fetch(address + '/tenant/acme/private')
  t.assert.deepStrictEqual(privateNoAuth.status, 403)

  const settingsNoAuth = await fetch(address + '/tenant/acme/settings')
  t.assert.deepStrictEqual(settingsNoAuth.status, 403)

  const privateWithAuth = await fetch(address + '/tenant/acme/private', {
    headers: { authorization: 'Bearer secret' }
  })
  t.assert.deepStrictEqual(privateWithAuth.status, 200)
  t.assert.deepStrictEqual(await privateWithAuth.json(), { secret: 'tenant-data' })
})

test('regex with grouped anchors is rewritten with prefix', async t => {
  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  const middlewareCalls = []

  await instance.register(async function (child) {
    child.use(/(?:^\/private|^\/settings)/, function (req, res) {
      middlewareCalls.push(req.originalUrl)
      res.statusCode = 403
      res.end('blocked by middleware')
    })

    child.get('/private', async () => ({ ok: true }))
    child.get('/settings', async () => ({ ok: true }))
    child.get('/public', async () => ({ ok: true }))
    child.get('/nested/private', async () => ({ ok: true }))
  }, { prefix: '/admin' })

  t.assert.deepStrictEqual((await instance.inject('/admin/private')).statusCode, 403)
  t.assert.deepStrictEqual((await instance.inject('/admin/settings')).statusCode, 403)
  t.assert.deepStrictEqual(middlewareCalls, ['/admin/private', '/admin/settings'])

  // The grouped anchors still pin the match to the start of the plugin path.
  middlewareCalls.length = 0
  t.assert.deepStrictEqual((await instance.inject('/admin/public')).statusCode, 200)
  t.assert.deepStrictEqual((await instance.inject('/admin/nested/private')).statusCode, 200)
  t.assert.deepStrictEqual(middlewareCalls, [])
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-f44m-4qwg-5587
test('path-scoped middleware is not skipped when the plugin prefix ends with a slash', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  await instance.register(async function (scope) {
    scope.use('/secret', function (_req, res) {
      middlewareCalls++
      res.statusCode = 401
      res.end('BLOCKED')
    })
    scope.get('/secret/data', async () => {
      return { leaked: 'CANARY' }
    })
  }, { prefix: '/api/' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/secret/data')
  t.assert.deepStrictEqual(result.status, 401)
  t.assert.equal(middlewareCalls, 1)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-f44m-4qwg-5587
test('path-scoped middleware is not skipped when the mount path omits its leading slash', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  await instance.register(async function (scope) {
    scope.use('secret', function (_req, res) {
      middlewareCalls++
      res.statusCode = 401
      res.end('BLOCKED')
    })
    scope.get('/secret/data', async () => {
      return { leaked: 'CANARY' }
    })
  }, { prefix: '/api' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/secret/data')
  t.assert.deepStrictEqual(result.status, 401)
  t.assert.equal(middlewareCalls, 1)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-f44m-4qwg-5587
test('array path-scoped middleware is not skipped when the prefix ends with a slash', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  await instance.register(async function (scope) {
    scope.use(['/secret', '/private'], function (_req, res) {
      middlewareCalls++
      res.statusCode = 401
      res.end('BLOCKED')
    })
    scope.get('/secret/data', async () => {
      return { leaked: 'CANARY' }
    })
  }, { prefix: '/api/' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/secret/data')
  t.assert.deepStrictEqual(result.status, 401)
  t.assert.equal(middlewareCalls, 1)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-f44m-4qwg-5587
test('the two spellings cancel correctly and still block the request', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  await instance.register(async function (scope) {
    scope.use('secret', function (_req, res) {
      middlewareCalls++
      res.statusCode = 401
      res.end('BLOCKED')
    })
    scope.get('/secret/data', async () => {
      return { leaked: 'CANARY' }
    })
  }, { prefix: '/api/' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/secret/data')
  t.assert.deepStrictEqual(result.status, 401)
  t.assert.equal(middlewareCalls, 1)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-r342-v25c-43wv
test('regex mount paths are not skipped when the prefix ends with a slash', async t => {
  t.plan(2)

  const instance = fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  await instance.register(async function (scope) {
    scope.use(/\/private/, function (_req, res) {
      middlewareCalls++
      res.statusCode = 401
      res.end('BLOCKED')
    })
    scope.get('/private/data', async () => {
      return { leaked: 'CANARY' }
    })
  }, { prefix: '/api/' })

  const address = await instance.listen({ port: 0 })

  const result = await fetch(address + '/api/private/data')
  t.assert.deepStrictEqual(result.status, 401)
  t.assert.equal(middlewareCalls, 1)
})

test('regex mount paths match however the prefix boundary slash is spelled', async t => {
  const mounts = [
    [/^\/private/, '/private/data'],
    [/[/]private/, '/private/data'],
    [/\x2fprivate/, '/private/data'],
    [/(?:\/private)/, '/private/data'],
    [/^\/private|^settings/, '/private/data'],
    [/^\/private|^settings/, '/settings'],
    [/private/, '/private/data'],
    [/(?:^\/private)/, '/private/data'],
    [/^\/admin|private/, '/nested/private']
  ]

  for (const prefix of ['/api', '/api/']) {
    for (const [mount, route] of mounts) {
      const label = `prefix=${prefix} use(${mount}) GET ${route}`
      const instance = fastify()
      t.after(() => instance.close())
      await instance.register(expressPlugin)

      let middlewareCalls = 0
      await instance.register(async function (scope) {
        scope.use(mount, function (_req, res) {
          middlewareCalls++
          res.statusCode = 401
          res.end('blocked')
        })
        scope.get(route, async () => ({ leaked: true }))
        scope.get('/public', async () => ({ ok: true }))
      }, { prefix })

      const blocked = await instance.inject('/api' + route)
      t.assert.deepStrictEqual(blocked.statusCode, 401, label)
      t.assert.deepStrictEqual(middlewareCalls, 1, label)

      const open = await instance.inject('/api/public')
      t.assert.deepStrictEqual(open.statusCode, 200, label)
    }
  }
})

test('escapes and character classes in regex mount paths are not rewritten', async t => {
  const instance = fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const middlewareCalls = []
  function block (name) {
    return function (_req, res) {
      middlewareCalls.push(name)
      res.statusCode = 401
      res.end('blocked')
    }
  }

  await instance.register(async function (scope) {
    // `\^` and `\|` are literals, `[^|]` is a class: none of them is an anchor
    // or an alternation, so none of them may be rewritten.
    scope.use(/\^caret/, block('escaped caret'))
    scope.use(/^\/a\|b/, block('escaped pipe'))
    scope.use(/^\/[^|]lass/, block('class'))
    // eslint-disable-next-line prefer-regex-literals -- the parser lacks the `v` flag
    scope.use(new RegExp('^\\/[[a-z]--[x]]ets', 'v'), block('nested class'))
    scope.get('/^caret', async () => ({ leaked: true }))
    scope.get('/a|b', async () => ({ leaked: true }))
    scope.get('/class', async () => ({ leaked: true }))
    scope.get('/sets', async () => ({ leaked: true }))
    scope.get('/a', async () => ({ ok: true }))
  }, { prefix: '/api' })

  for (const [url, name] of [
    ['/api/%5Ecaret', 'escaped caret'],
    ['/api/a%7Cb', 'escaped pipe'],
    ['/api/class', 'class'],
    ['/api/sets', 'nested class']
  ]) {
    middlewareCalls.length = 0
    const response = await instance.inject(url)
    t.assert.deepStrictEqual(response.statusCode, 401, url)
    t.assert.deepStrictEqual(middlewareCalls, [name], url)
  }

  middlewareCalls.length = 0
  t.assert.deepStrictEqual((await instance.inject('/api/a')).statusCode, 200)
  t.assert.deepStrictEqual(middlewareCalls, [])
})

test('named groups in prefixed regex mount paths keep their names', async t => {
  const instance = fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  let params
  await instance.register(async function (scope) {
    scope.use(/^\/user\/(?<id>\d+)/, function (req, res) {
      params = req.params
      res.statusCode = 401
      res.end('blocked')
    })
    scope.get('/user/:id', async () => ({ leaked: true }))
  }, { prefix: '/api' })

  const response = await instance.inject('/api/user/42')
  t.assert.deepStrictEqual(response.statusCode, 401)
  t.assert.deepStrictEqual(params, { id: '42' })
})

test('regex mount paths at the root are matched against the full path', async t => {
  const instance = fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use(/^\/private/, function (_req, res) {
    res.statusCode = 401
    res.end('blocked')
  })
  instance.get('/private', async () => ({ leaked: true }))
  instance.get('/public', async () => ({ ok: true }))

  t.assert.deepStrictEqual((await instance.inject('/private')).statusCode, 401)
  t.assert.deepStrictEqual((await instance.inject('/public')).statusCode, 200)
})

test('regex mount paths with the g or y flag do not skip every other request', async t => {
  for (const [prefix, mount] of [
    ['', /^\/private/g],
    ['', /^\/private/y],
    ['/api', /^\/private/g],
    ['/api', /^\/private/y]
  ]) {
    const label = `prefix=${prefix} use(${mount})`
    const instance = fastify()
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    let middlewareCalls = 0
    await instance.register(async function (scope) {
      scope.use(mount, function (_req, res) {
        middlewareCalls++
        res.statusCode = 401
        res.end('blocked')
      })
      scope.get('/private', async () => ({ leaked: true }))
    }, { prefix })

    for (let i = 0; i < 4; i++) {
      const response = await instance.inject(prefix + '/private')
      t.assert.deepStrictEqual(response.statusCode, 401, `${label} request ${i}`)
    }
    t.assert.deepStrictEqual(middlewareCalls, 4, label)
  }
})

test('mount paths are collapsed like routes when ignoreDuplicateSlashes is enabled', async t => {
  for (const [prefix, mount] of [
    ['/api', '//private'],
    ['/api', ['//private']],
    ['/api//v1', '/private'],
    ['/api//v1', /^\/private/],
    ['/api/', '//private'],
    ['/api', 'private']
  ]) {
    const label = `prefix=${prefix} use(${mount})`
    const instance = fastify({ routerOptions: { ignoreDuplicateSlashes: true } })
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    let middlewareCalls = 0
    await instance.register(async function (scope) {
      scope.use(mount, function (_req, res) {
        middlewareCalls++
        res.statusCode = 401
        res.end('blocked')
      })
      scope.get('/private/data', async () => ({ leaked: true }))
    }, { prefix })

    const url = prefix.replace(/\/+$/, '').replace(/\/{2,}/g, '/') + '/private/data'
    for (const requestUrl of [url, url.replace(/\//g, '//')]) {
      const response = await instance.inject(requestUrl)
      t.assert.deepStrictEqual(response.statusCode, 401, `${label} GET ${requestUrl}`)
    }
    t.assert.deepStrictEqual(middlewareCalls, 2, label)
  }
})

test('prefixed regex mount paths that can match the empty string still run', async t => {
  for (const mount of [/^(?!\/public)/, /^/, /(?:)/, /^(?:\/admin)?/]) {
    const label = `use(${mount})`
    const instance = fastify()
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    await instance.register(async function (scope) {
      scope.use(mount, function (_req, res) {
        res.statusCode = 401
        res.end('blocked')
      })
      scope.get('/secret', async () => ({ leaked: true }))
    }, { prefix: '/api' })

    t.assert.deepStrictEqual((await instance.inject('/api/secret')).statusCode, 401, label)
  }
})

test('prefixed regex mount paths that match the root also cover the bare prefix', async t => {
  for (const mount of [/^\/.*/, /^\/$/, /^\/(?!public)/]) {
    const label = `use(${mount})`
    const instance = fastify()
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    await instance.register(async function (scope) {
      scope.use(mount, function (_req, res) {
        res.statusCode = 401
        res.end('blocked')
      })
      scope.get('/', async () => ({ leaked: true }))
      scope.get('/public', async () => ({ ok: true }))
    }, { prefix: '/api' })

    t.assert.deepStrictEqual((await instance.inject('/api')).statusCode, 401, `${label} GET /api`)
    t.assert.deepStrictEqual((await instance.inject('/api/')).statusCode, 401, `${label} GET /api/`)
  }

  // A pattern that does not match the root leaves the bare prefix alone.
  const instance = fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)
  await instance.register(async function (scope) {
    scope.use(/^\/private/, function (_req, res) {
      res.statusCode = 401
      res.end('blocked')
    })
    scope.get('/', async () => ({ ok: true }))
  }, { prefix: '/api' })
  t.assert.deepStrictEqual((await instance.inject('/api')).statusCode, 200)
})

test('slashless mount paths cover both the glued and the separated route', async t => {
  const instance = fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  let middlewareCalls = 0
  await instance.register(async function (scope) {
    scope.use('secret', function (_req, res) {
      middlewareCalls++
      res.statusCode = 401
      res.end('blocked')
    })
    // Fastify serves a slashless route glued to the prefix, at /apisecret.
    scope.get('secret', async () => ({ leaked: true }))
    scope.get('/secret/data', async () => ({ leaked: true }))
  }, { prefix: '/api' })

  t.assert.deepStrictEqual((await instance.inject('/apisecret')).statusCode, 401)
  t.assert.deepStrictEqual((await instance.inject('/api/secret/data')).statusCode, 401)
  t.assert.deepStrictEqual(middlewareCalls, 2)
})

// @see https://github.com/fastify/fastify-express/security/advisories/GHSA-84w6-xrf3-f8q8
// Prefix segments holding a parameter match one whole segment, whatever the
// parameter regex says, so the pattern stays valid under the `u` and `v` flags
// and anchors inside the parameter regex cannot leak into the pattern.
test('regex mount paths under parameterized prefixes with flags and anchored parameter regexes', async t => {
  for (const [prefix, mount, url] of [
    // eslint-disable-next-line prefer-regex-literals -- the parser lacks the `v` flag
    ['/tenant/:id', new RegExp('^\\/admin', 'v'), '/tenant/t1/admin'],
    ['/d/:date(\\d{4}\\-\\d{2})', /^\/admin/u, '/d/2024-01/admin'],
    ['/u/:id(^\\d+$|^me$)', /^\/admin/, '/u/me/admin'],
    ['/r/:from-:to', /^\/admin/, '/r/a-b/admin'],
    ['/a::b/:id', /^\/admin/, '/a:b/1/admin'],
    ['/g/:id((?:x|y)\\d+)', /^\/admin/, '/g/x1/admin']
  ]) {
    const label = `prefix=${prefix} use(${mount})`
    const instance = fastify()
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    let middlewareCalls = 0
    await instance.register(async function (scope) {
      scope.use(mount, function (_req, res) {
        middlewareCalls++
        res.statusCode = 401
        res.end('blocked')
      })
      scope.get('/admin', async () => ({ leaked: true }))
      scope.get('/public', async () => ({ ok: true }))
    }, { prefix })

    t.assert.deepStrictEqual((await instance.inject(url)).statusCode, 401, label)
    t.assert.deepStrictEqual(middlewareCalls, 1, label)
    t.assert.deepStrictEqual((await instance.inject(url.replace(/admin$/, 'public'))).statusCode, 200, label)
  }
})

test('regex mount paths under prefixes with many parameters in one segment do not backtrack', async t => {
  const instance = fastify({ routerOptions: { maxParamLength: 500 } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  await instance.register(async function (scope) {
    scope.use(/^\/admin/, function (_req, res) {
      res.statusCode = 401
      res.end('blocked')
    })
    scope.get('/x', async () => ({ ok: true }))
  }, { prefix: '/t/:a-:b-:c-:d' })

  const start = process.hrtime.bigint()
  const response = await instance.inject('/t/' + '-'.repeat(500) + '-b-c-d/x')
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6

  t.assert.deepStrictEqual(response.statusCode, 200)
  t.assert.ok(elapsedMs < 1000, `matcher took ${elapsedMs.toFixed(0)}ms`)
})
