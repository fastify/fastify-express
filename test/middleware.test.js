'use strict'

// Original Fastify test/middlewares.test.js file

const { test } = require('node:test')
const sget = require('simple-get').concat
const fastify = require('fastify')
const fp = require('fastify-plugin')
const cors = require('cors')
const helmet = require('helmet')

const expressPlugin = require('../index')

test('use a middleware', (t, done) => {
  t.plan(7)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      const useRes = instance.use(function (req, res, next) {
        t.assert.ok('middleware called')
        next()
      })

      t.assert.strictEqual(useRes, instance)
    })

  instance.get('/', function (request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.assert.ifError(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.strictEqual(response.statusCode, 200)
      t.assert.strictEqual(response.headers['content-length'], '' + body.length)
      t.assert.deepStrictEqual(JSON.parse(body), { hello: 'world' })
      instance.close()
      done()
    })
  })
})

test('use cors', (t, done) => {
  t.plan(3)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(cors())
    })

  instance.get('/', function (request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.assert.ifError(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.strictEqual(response.headers['access-control-allow-origin'], '*')
      instance.close()
      done()
    })
  })
})

test('use helmet', (t, done) => {
  t.plan(3)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(helmet())
    })

  instance.get('/', function (request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.assert.ifError(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.ok(response.headers['x-xss-protection'])
      instance.close()
      done()
    })
  })
})

test('use helmet and cors', (t, done) => {
  t.plan(4)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(cors())
      instance.use(helmet())
    })

  instance.get('/', function (request, reply) {
    reply.send({ hello: 'world' })
  })

  instance.listen({ port: 0 }, err => {
    t.assert.ifError(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.ok(response.headers['x-xss-protection'])
      t.assert.strictEqual(response.headers['access-control-allow-origin'], '*')
      instance.close()
      done()
    })
  })
})

test('middlewares with prefix', async t => {
  t.plan(4)

  const instance = fastify()
  await instance.register(expressPlugin)
  instance.use(function (req, res, next) {
    req.global = true
    next()
  })
  instance.use('', function (req, res, next) {
    req.global2 = true
    next()
  })
  instance.use('/', function (req, res, next) {
    req.root = true
    next()
  })
  instance.use('/prefix', function (req, res, next) {
    req.prefixed = true
    next()
  })
  instance.use('/prefix/', function (req, res, next) {
    req.slashed = true
    next()
  })

  async function handler (request, reply) {
    return reply.send({
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

  await instance.listen({ port: 0 })
  await instance.ready()
  await t.test('/', (t, done) => {
    t.plan(2)
    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port + '/',
      json: true
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.deepStrictEqual(body, {
        global: true,
        global2: true,
        root: true
      })
      done()
    })
  })

  await t.test('/prefix', (t, done) => {
    t.plan(2)
    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port + '/prefix',
      json: true
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.deepStrictEqual(body, {
        prefixed: true,
        global: true,
        global2: true,
        root: true,
        slashed: true
      })
      done()
    })
  })

  await t.test('/prefix/', (t, done) => {
    t.plan(2)
    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port + '/prefix/',
      json: true
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.deepStrictEqual(body, {
        prefixed: true,
        slashed: true,
        global: true,
        global2: true,
        root: true
      })
      done()
    })
  })

  await t.test('/prefix/inner', (t, done) => {
    t.plan(2)
    sget({
      method: 'GET',
      url: 'http://localhost:' + instance.server.address().port + '/prefix/inner',
      json: true
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.deepStrictEqual(body, {
        prefixed: true,
        slashed: true,
        global: true,
        global2: true,
        root: true
      })
      instance.close()
      done()
    })
  })
})

test('res.end should block middleware execution', (t, done) => {
  t.plan(6)

  const instance = fastify()
  instance.register(expressPlugin)
    .after(() => {
      instance.use(function (req, res, next) {
        res.send('hello')
      })

      instance.use(function (req, res, next) {
        t.assert.fail('we should not be here')
      })
    })

  instance.addHook('onRequest', (req, res, next) => {
    t.assert.ok('called')
    next()
  })

  instance.addHook('preHandler', (req, reply, next) => {
    t.assert.fail('this should not be called')
  })

  instance.addHook('onSend', (req, reply, payload, next) => {
    t.assert.ok('called')
    next(null, payload)
  })

  instance.addHook('onResponse', (request, reply, next) => {
    t.assert.ok('called')
    next()
  })

  instance.get('/', function (request, reply) {
    t.assert.fail('we should no be here')
  })

  instance.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 200)
      t.assert.strictEqual(data.toString(), 'hello')
      instance.close()
      done()
    })
  })
})

test('Use a middleware inside a plugin after an encapsulated plugin', (t, done) => {
  t.plan(5)
  const f = fastify()
  f.register(expressPlugin)

  f.register(function (instance, opts, next) {
    instance.use(function (req, res, next) {
      t.assert.ok('first middleware called')
      next()
    })

    instance.get('/', function (request, reply) {
      reply.send({ hello: 'world' })
    })

    next()
  })

  f.register(fp(function (instance, opts, next) {
    instance.use(function (req, res, next) {
      t.assert.ok('second middleware called')
      next()
    })

    next()
  }))

  f.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
      f.close()
      done()
    })
  })
})

test('middlewares should run in the order in which they are defined', (t, done) => {
  t.plan(10)
  const f = fastify()
  f.register(expressPlugin)

  f.register(fp(function (instance, opts, next) {
    instance.use(function (req, res, next) {
      t.assert.strictEqual(req.previous, undefined)
      req.previous = 1
      next()
    })

    instance.register(fp(function (i, opts, next) {
      i.use(function (req, res, next) {
        t.assert.strictEqual(req.previous, 2)
        req.previous = 3
        next()
      })
      next()
    }))

    instance.use(function (req, res, next) {
      t.assert.strictEqual(req.previous, 1)
      req.previous = 2
      next()
    })

    next()
  }))

  f.register(function (instance, opts, next) {
    instance.use(function (req, res, next) {
      t.assert.strictEqual(req.previous, 3)
      req.previous = 4
      next()
    })

    instance.get('/', function (request, reply) {
      t.assert.strictEqual(request.raw.previous, 5)
      reply.send({ hello: 'world' })
    })

    instance.register(fp(function (i, opts, next) {
      i.use(function (req, res, next) {
        t.assert.strictEqual(req.previous, 4)
        req.previous = 5
        next()
      })
      next()
    }))

    next()
  })

  f.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
      f.close()
      done()
    })
  })
})
