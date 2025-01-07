'use strict'

// Original Fastify test/middlewares.test.js file

const t = require('tap')
const test = t.test
const sget = require('simple-get').concat
const fastify = require('fastify')
const fp = require('fastify-plugin')
const cors = require('cors')
const helmet = require('helmet')

const expressPlugin = require('../index')

test('use a middleware', t => {
  t.plan(7)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      const useRes = instance.use(function (_req, _res, next) {
        t.pass('middleware called')
        next()
      })

      t.equal(useRes, instance)
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.error(err)

    t.teardown(instance.server.close.bind(instance.server))

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 200)
      t.equal(response.headers['content-length'], '' + body.length)
      t.same(JSON.parse(body), { hello: 'world' })
    })
  })
})

test('use cors', t => {
  t.plan(3)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(cors())
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.error(err)

    t.teardown(instance.server.close.bind(instance.server))

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response) => {
      t.error(err)
      t.equal(response.headers['access-control-allow-origin'], '*')
    })
  })
})

test('use helmet', t => {
  t.plan(3)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(helmet())
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.error(err)

    t.teardown(instance.server.close.bind(instance.server))

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response) => {
      t.error(err)
      t.ok(response.headers['x-xss-protection'])
    })
  })
})

test('use helmet and cors', t => {
  t.plan(4)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(cors())
      instance.use(helmet())
    })

  instance.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.error(err)

    t.teardown(instance.server.close.bind(instance.server))

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response) => {
      t.error(err)
      t.ok(response.headers['x-xss-protection'])
      t.equal(response.headers['access-control-allow-origin'], '*')
    })
  })
})

test('middlewares with prefix', t => {
  t.plan(5)

  const instance = fastify()
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

  instance.listen({ port: 0 }, err => {
    t.error(err)
    t.teardown(instance.server.close.bind(instance.server))

    t.test('/', t => {
      t.plan(2)
      sget({
        method: 'GET',
        url: 'http://localhost:' + instance.server.address().port + '/',
        json: true
      }, (err, _response, body) => {
        t.error(err)
        t.same(body, {
          global: true,
          global2: true,
          root: true
        })
      })
    })

    t.test('/prefix', t => {
      t.plan(2)
      sget({
        method: 'GET',
        url: 'http://localhost:' + instance.server.address().port + '/prefix',
        json: true
      }, (err, _response, body) => {
        t.error(err)
        t.same(body, {
          prefixed: true,
          global: true,
          global2: true,
          root: true,
          slashed: true
        })
      })
    })

    t.test('/prefix/', t => {
      t.plan(2)
      sget({
        method: 'GET',
        url: 'http://localhost:' + instance.server.address().port + '/prefix/',
        json: true
      }, (err, _response, body) => {
        t.error(err)
        t.same(body, {
          prefixed: true,
          slashed: true,
          global: true,
          global2: true,
          root: true
        })
      })
    })

    t.test('/prefix/inner', t => {
      t.plan(2)
      sget({
        method: 'GET',
        url: 'http://localhost:' + instance.server.address().port + '/prefix/inner',
        json: true
      }, (err, _response, body) => {
        t.error(err)
        t.same(body, {
          prefixed: true,
          slashed: true,
          global: true,
          global2: true,
          root: true
        })
      })
    })
  })
})

test('res.end should block middleware execution', t => {
  t.plan(6)

  const instance = fastify()
  t.teardown(instance.close)
  instance.register(expressPlugin)
    .after(() => {
      instance.use(function (_req, res) {
        res.send('hello')
      })

      instance.use(function () {
        t.fail('we should not be here')
      })
    })

  instance.addHook('onRequest', (_req, _res, next) => {
    t.ok('called')
    next()
  })

  instance.addHook('preHandler', () => {
    t.fail('this should not be called')
  })

  instance.addHook('onSend', (_req, _reply, payload, next) => {
    t.ok('called')
    next(null, payload)
  })

  instance.addHook('onResponse', (_request, _reply, next) => {
    t.ok('called')
    next()
  })

  instance.get('/', function () {
    t.fail('we should no be here')
  })

  instance.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.equal(data.toString(), 'hello')
    })
  })
})

test('Use a middleware inside a plugin after an encapsulated plugin', t => {
  t.plan(5)
  const f = fastify()
  t.teardown(f.close)
  f.register(expressPlugin)

  f.register(function (instance, _opts, next) {
    instance.use(function (_req, _res, next) {
      t.ok('first middleware called')
      next()
    })

    instance.get('/', function (_request, reply) {
      reply.send({ hello: 'world' })
    })

    next()
  })

  f.register(fp(function (instance, _opts, next) {
    instance.use(function (_req, _res, next) {
      t.ok('second middleware called')
      next()
    })

    next()
  }))

  f.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(data), { hello: 'world' })
    })
  })
})

test('middlewares should run in the order in which they are defined', t => {
  t.plan(10)
  const f = fastify()
  t.teardown(f.close)
  f.register(expressPlugin)

  f.register(fp(function (instance, _opts, next) {
    instance.use(function (req, _res, next) {
      t.equal(req.previous, undefined)
      req.previous = 1
      next()
    })

    instance.register(fp(function (i, _opts, next) {
      i.use(function (req, _res, next) {
        t.equal(req.previous, 2)
        req.previous = 3
        next()
      })
      next()
    }))

    instance.use(function (req, _res, next) {
      t.equal(req.previous, 1)
      req.previous = 2
      next()
    })

    next()
  }))

  f.register(function (instance, _opts, next) {
    instance.use(function (req, _res, next) {
      t.equal(req.previous, 3)
      req.previous = 4
      next()
    })

    instance.get('/', function (request, reply) {
      t.equal(request.raw.previous, 5)
      reply.send({ hello: 'world' })
    })

    instance.register(fp(function (i, _opts, next) {
      i.use(function (req, _res, next) {
        t.equal(req.previous, 4)
        req.previous = 5
        next()
      })
      next()
    }))

    next()
  })

  f.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(data), { hello: 'world' })
    })
  })
})
