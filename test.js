'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const sget = require('simple-get').concat
const cors = require('cors')

const expressPlugin = require('./index')

test('Should support connect style middlewares', t => {
  t.plan(3)

  const fastify = Fastify()

  fastify
    .register(expressPlugin)
    .after(() => fastify.use(cors()))
    .listen(0, (err, address) => {
      t.error(err)
      sget({
        method: 'GET',
        url: address
      }, (err, res, data) => {
        t.error(err)
        t.match(res.headers, {
          'access-control-allow-origin': '*'
        })
        fastify.close()
      })
    })
})

test('Middleware chain', t => {
  t.plan(5)

  const order = [1, 2, 3]
  const fastify = Fastify()

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
        .use(middleware3)
    })
    .listen(0, (err, address) => {
      t.error(err)
      sget({
        method: 'GET',
        url: address
      }, (err, res, data) => {
        t.error(err)
        fastify.close()
      })
    })

  function middleware1 (req, res, next) {
    t.strictEqual(order.shift(), 1)
    next()
  }

  function middleware2 (req, res, next) {
    t.strictEqual(order.shift(), 2)
    next()
  }

  function middleware3 (req, res, next) {
    t.strictEqual(order.shift(), 3)
    next()
  }
})

test('Middleware chain (with errors)', t => {
  t.plan(8)

  const order = [1, 2, 3]
  const fastify = Fastify()

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
        .use(middleware3)
    })
    .listen(0, (err, address) => {
      t.error(err)
      sget({
        method: 'GET',
        url: address
      }, (err, res, data) => {
        t.error(err)
        t.strictEqual(res.statusCode, 500)
        fastify.close()
      })
    })

  function middleware1 (req, res, next) {
    t.strictEqual(order.shift(), 1)
    next(new Error('middleware1'))
  }

  function middleware2 (err, req, res, next) {
    t.is(err.message, 'middleware1')
    t.strictEqual(order.shift(), 2)
    next(new Error('middleware2'))
  }

  function middleware3 (err, req, res, next) {
    t.is(err.message, 'middleware2')
    t.strictEqual(order.shift(), 3)
    next(new Error('kaboom'))
  }
})

test('Send a response from a middleware', t => {
  t.plan(4)

  const fastify = Fastify()

  fastify
    .register(expressPlugin)
    .after(() => {
      fastify
        .use(middleware1)
        .use(middleware2)
    })

  fastify.addHook('preValidation', (req, reply, next) => {
    t.fail('We should not be here')
  })

  fastify.addHook('preParsing', (req, reply, next) => {
    t.fail('We should not be here')
  })

  fastify.addHook('preHandler', (req, reply, next) => {
    t.fail('We should not be here')
  })

  fastify.addHook('onSend', (req, reply, next) => {
    t.fail('We should not be here')
  })

  fastify.addHook('onResponse', (req, reply, next) => {
    t.ok('called')
    next()
  })

  fastify.get('/', (req, reply) => {
    t.fail('We should not be here')
  })

  fastify.listen(0, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address,
      json: true
    }, (err, res, data) => {
      t.error(err)
      t.deepEqual(data, { hello: 'world' })
      fastify.close()
    })
  })

  function middleware1 (req, res, next) {
    res.send({ hello: 'world' })
  }

  function middleware2 (req, res, next) {
    t.fail('We should not be here')
  }
})
