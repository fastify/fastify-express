'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('Should enhance the Node.js core request/response objects', (t, done) => {
  t.plan(10)
  const fastify = Fastify()

  fastify.register(expressPlugin)

  fastify.get('/', async (req, reply) => {
    t.assert.strictEqual(req.raw.originalUrl, req.raw.url)
    t.assert.strictEqual(req.raw.id, req.id)
    t.assert.strictEqual(req.raw.hostname, req.hostname)
    t.assert.strictEqual(req.raw.protocol, req.protocol)
    t.assert.strictEqual(req.raw.ip, req.ip)
    t.assert.deepStrictEqual(req.raw.ips, req.ips)
    t.assert.ok(req.raw.log)
    t.assert.ok(reply.raw.log)
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.assert.ifError(err)
      fastify.close()
      done()
    })
  })
})

test('trust proxy protocol', (t, done) => {
  t.plan(5)
  const fastify = Fastify({ trustProxy: true })

  fastify.register(expressPlugin).after(() => {
    fastify.use('/', function (req, res) {
      t.assert.strictEqual(req.ip, '1.1.1.1', 'gets ip from x-forwarded-for')
      t.assert.strictEqual(req.hostname, 'example.com', 'gets hostname from x-forwarded-host')
      t.assert.strictEqual(req.protocol, 'lorem', 'gets protocol from x-forwarded-proto')

      res.sendStatus(200)
    })
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      headers: {
        'X-Forwarded-For': '1.1.1.1',
        'X-Forwarded-Host': 'example.com',
        'X-Forwarded-Proto': 'lorem'
      },
      url: address
    }, (err, res, data) => {
      t.assert.ifError(err)
      fastify.close()
      done()
    })
  })
})

test('passing createProxyHandler sets up a Proxy with Express req', (t, done) => {
  t.plan(8)
  const testString = 'test proxy'

  const fastify = Fastify()
  fastify.register(expressPlugin, {
    createProxyHandler: () => ({
      set (target, prop, value) {
        if (prop === 'customField') {
          t.assert.strictEqual(value, testString)
        }

        return Reflect.set(target, prop, value)
      },
      get (target, prop) {
        if (prop === 'customField') {
          t.assert.ok('get customField called')
        }

        return target[prop]
      }
    })
  })
    .after(() => {
      fastify.use(function (req, res, next) {
        req.customField = testString
        t.assert.strictEqual(req.customField, testString)
        next()
      })
    })

  fastify.get('/', function (request, reply) {
    reply.send({ hello: 'world' })
  })

  fastify.listen({ port: 0 }, err => {
    t.assert.ifError(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.strictEqual(response.statusCode, 200)
      t.assert.strictEqual(response.headers['content-length'], '' + body.length)
      t.assert.deepStrictEqual(JSON.parse(body), { hello: 'world' })
      fastify.close()
      done()
    })
  })
})

test('createProxyHandler has access to Fastify request object', (t, done) => {
  t.plan(12)
  const startTestString = 'original'

  const fastify = Fastify()
  fastify.decorateRequest('getAndSetFastify', startTestString)
  fastify.decorateRequest('getOnlyFastify', startTestString)

  fastify.register(expressPlugin, {
    createProxyHandler: fastifyReq => ({
      set (target, prop, value) {
        if (prop === 'getAndSetFastify') {
          t.assert.ok('set to Fastify called')
          return Reflect.set(fastifyReq, prop, value)
        } else if (prop === 'getOnlyFastify') {
          return true
        } else {
          return Reflect.set(target, prop, value)
        }
      },
      get (target, prop) {
        if (prop === 'getAndSetFastify' || prop === 'getOnlyFastify') {
          // Return something from Fastify req
          t.assert.ok('get from Fastify called')
          return fastifyReq[prop]
        }

        return target[prop]
      }
    })
  })
    .after(() => {
      fastify.use(function (req, res, next) {
        t.assert.strictEqual(req.getAndSetFastify, startTestString)
        t.assert.strictEqual(req.getOnlyFastify, startTestString)
        req.getAndSetFastify = 'updated'
        req.getOnlyFastify = 'updated'
        next()
      })
    })

  fastify.get('/', function (request, reply) {
    // getOnlyFastify should change and getOnlyFastify should not
    t.assert.strictEqual(request.getAndSetFastify, 'updated')
    t.assert.strictEqual(request.getOnlyFastify, startTestString)

    reply.send({ hello: 'world' })
  })

  fastify.listen({ port: 0 }, err => {
    t.assert.ifError(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.assert.ifError(err)
      t.assert.strictEqual(response.statusCode, 200)
      t.assert.strictEqual(response.headers['content-length'], '' + body.length)
      t.assert.deepStrictEqual(JSON.parse(body), { hello: 'world' })
      fastify.close()
      done()
    })
  })
})
