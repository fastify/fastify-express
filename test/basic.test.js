'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const cors = require('cors')
const passport = require('passport')
const Strategy = require('passport-http-bearer').Strategy

const expressPlugin = require('../index')

test('Should support connect style middlewares', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(cors()) })

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('Should support connect style middlewares (async await)', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(expressPlugin)
  fastify.use(cors())

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('Should support connect style middlewares (async await after)', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(expressPlugin)
  await fastify.after()
  fastify.use(cors())

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })
  const result = await fetch(address)
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('Should support per path middlewares', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use('/cors', cors()) })

  fastify.get('/cors/hello', async () => {
    return { hello: 'world' }
  })

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/cors/hello')
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')

  const result2 = await fetch(address)
  t.assert.deepStrictEqual(result2.headers.get('access-control-allow-origin'), null)
})

test('Should support complex middlewares', async t => {
  t.plan(3)

  const fastify = Fastify()

  passport.use(new Strategy((token, cb) => {
    t.assert.deepStrictEqual(token, '123456789')
    cb(null, { token })
  }))

  t.after(() => fastify.close())

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(passport.authenticate('bearer', { session: false })) })

  fastify
    .get('/', (req, reply) => {
      t.assert.deepStrictEqual(req.raw.user, { token: '123456789' })
      reply.send('ok')
    })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address, {
    headers: {
      authorization: 'Bearer 123456789'
    }
  })

  t.assert.ok(result.ok)
})

test('Encapsulation support / 1', async t => {
  t.plan(1)

  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify.register((instance, _opts, next) => {
    instance.register(expressPlugin)
      .after(() => { instance.use(middleware) })

    instance.get('/plugin', (_req, reply) => {
      reply.send('ok')
    })

    next()
  })

  fastify.get('/', (_req, reply) => {
    reply.send('ok')
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.ok(result.ok)

  function middleware () {
    t.assert.fail('Shuld not be called')
  }
})

test('Encapsulation support / 2', async t => {
  t.plan(1)

  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify.register(expressPlugin)

  fastify.register((instance, _opts, next) => {
    instance.use(middleware)
    instance.get('/plugin', (_req, reply) => {
      reply.send('ok')
    })

    next()
  })

  fastify.get('/', (_req, reply) => {
    reply.send('ok')
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.ok(result.ok)

  function middleware () {
    t.assert.fail('Shuld not be called')
  }
})

test('Encapsulation support / 3', async t => {
  t.plan(2)

  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify.register(expressPlugin)

  fastify.register((instance, _opts, next) => {
    instance.use(cors())
    instance.get('/plugin', (_req, reply) => {
      reply.send('ok')
    })

    next()
  })

  fastify.get('/', (_req, reply) => {
    reply.send('ok')
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/plugin')
  t.assert.deepStrictEqual(result.headers.get('access-control-allow-origin'), '*')

  const result2 = await fetch(address)
  t.assert.deepStrictEqual(result2.headers.get('access-control-allow-origin'), null)
})

test('Encapsulation support / 4', async t => {
  t.plan(3)

  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify.register(expressPlugin)
  fastify.after(() => {
    fastify.use(middleware1)
  })

  fastify.register((instance, _opts, next) => {
    instance.use(middleware2)
    instance.get('/plugin', (_req, reply) => {
      reply.send('ok')
    })

    next()
  })

  fastify.get('/', (_req, reply) => {
    reply.send('ok')
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/plugin')
  t.assert.deepStrictEqual(result.headers.get('x-middleware-1'), 'true')
  t.assert.deepStrictEqual(result.headers.get('x-middleware-2'), 'true')

  const result2 = await fetch(address)
  t.assert.deepStrictEqual(result2.headers.get('x-middleware-1'), 'true')

  function middleware1 (_req, res, next) {
    res.setHeader('x-middleware-1', true)
    next()
  }

  function middleware2 (_req, res, next) {
    res.setHeader('x-middleware-2', true)
    next()
  }
})

test('Encapsulation support / 5', async t => {
  t.plan(6)

  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify.register(expressPlugin)
  fastify.after(() => {
    fastify.use(middleware1)
  })

  fastify.register((instance, _opts, next) => {
    instance.use(middleware2)
    instance.get('/', (_req, reply) => {
      reply.send('ok')
    })

    instance.register((i, _opts, next) => {
      i.use(middleware3)
      i.get('/nested', (_req, reply) => {
        reply.send('ok')
      })

      next()
    })

    next()
  }, { prefix: '/plugin' })

  fastify.get('/', (_req, reply) => {
    reply.send('ok')
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/plugin/nested')
  t.assert.deepStrictEqual(result.headers.get('x-middleware-1'), 'true')
  t.assert.deepStrictEqual(result.headers.get('x-middleware-2'), 'true')
  t.assert.deepStrictEqual(result.headers.get('x-middleware-3'), 'true')

  const result2 = await fetch(address + '/plugin')
  t.assert.deepStrictEqual(result2.headers.get('x-middleware-1'), 'true')
  t.assert.deepStrictEqual(result2.headers.get('x-middleware-2'), 'true')

  const result3 = await fetch(address)
  t.assert.deepStrictEqual(result3.headers.get('x-middleware-1'), 'true')

  function middleware1 (_req, res, next) {
    res.setHeader('x-middleware-1', true)
    next()
  }

  function middleware2 (_req, res, next) {
    res.setHeader('x-middleware-2', true)
    next()
  }

  function middleware3 (_req, res, next) {
    res.setHeader('x-middleware-3', true)
    next()
  }
})

test('Middleware chain', async t => {
  t.plan(4)

  const order = [1, 2, 3]
  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
        .use(middleware3)
    })

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.ok(result.ok)

  function middleware1 (_req, _res, next) {
    t.assert.deepStrictEqual(order.shift(), 1)
    next()
  }

  function middleware2 (_req, _res, next) {
    t.assert.deepStrictEqual(order.shift(), 2)
    next()
  }

  function middleware3 (_req, _res, next) {
    t.assert.deepStrictEqual(order.shift(), 3)
    next()
  }
})

test('Middleware chain (with errors) / 1', async t => {
  t.plan(6)

  const order = [1, 2, 3]
  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
        .use(middleware3)
    })

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.status, 500)

  function middleware1 (_req, _res, next) {
    t.assert.deepStrictEqual(order.shift(), 1)
    next(new Error('middleware1'))
  }

  function middleware2 (err, _req, _res, next) {
    t.assert.deepStrictEqual(err.message, 'middleware1')
    t.assert.deepStrictEqual(order.shift(), 2)
    next(new Error('middleware2'))
  }

  function middleware3 (err, _req, _res, next) {
    t.assert.deepStrictEqual(err.message, 'middleware2')
    t.assert.deepStrictEqual(order.shift(), 3)
    next(new Error('kaboom'))
  }
})

test('Middleware chain (with errors) / 2', async t => {
  t.plan(5)

  const order = [1, 2]
  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify.setErrorHandler((err, _req, reply) => {
    t.assert.deepStrictEqual(err.message, 'middleware2')
    reply.send(err)
  })

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
        .use(middleware3)
    })

  fastify.get('/', async () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.status, 500)

  function middleware1 (_req, _res, next) {
    t.assert.deepStrictEqual(order.shift(), 1)
    next(new Error('middleware1'))
  }

  function middleware2 (err, _req, _res, next) {
    t.assert.deepStrictEqual(err.message, 'middleware1')
    t.assert.deepStrictEqual(order.shift(), 2)
    next(new Error('middleware2'))
  }

  function middleware3 () {
    t.assert.fail('We should not be here')
  }
})

test('Send a response from a middleware', async t => {
  t.plan(3)

  const fastify = Fastify()

  t.after(() => fastify.close())

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
    })

  fastify.addHook('preValidation', () => {
    t.assert.fail('We should not be here')
  })

  fastify.addHook('preParsing', () => {
    t.assert.fail('We should not be here')
  })

  fastify.addHook('preHandler', () => {
    t.assert.fail('We should not be here')
  })

  fastify.addHook('onSend', (_req, _reply, payload, next) => {
    t.assert.ok('called')
    next(null, payload)
  })

  fastify.addHook('onResponse', (_req, _reply, next) => {
    t.assert.ok('called')
    next()
  })

  fastify.get('/', () => {
    t.assert.fail('We should not be here')
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })

  function middleware1 (_req, res) {
    res.send({ hello: 'world' })
  }

  function middleware2 () {
    t.assert.fail('We should not be here')
  }
})

test('Should support plugin level prefix', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(expressPlugin)

  fastify.register((instance, _opts, next) => {
    instance.use('/world', (_req, res, next) => {
      res.setHeader('x-foo', 'bar')
      next()
    })

    instance.get('/world', (_req, reply) => {
      reply.send({ hello: 'world' })
    })

    next()
  }, { prefix: '/hello' })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/hello/world')
  t.assert.deepStrictEqual(result.headers.get('x-foo'), 'bar')
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})
