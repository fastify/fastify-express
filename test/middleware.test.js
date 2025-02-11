'use strict'

// Original Fastify test/middlewares.test.js file

const { test } = require('node:test')
const sget = require('simple-get').concat
const fastify = require('fastify')
const fp = require('fastify-plugin')
const cors = require('cors')
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
