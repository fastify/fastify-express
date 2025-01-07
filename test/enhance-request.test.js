'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('Should enhance the Node.js core request/response objects', t => {
  t.plan(10)
  const fastify = Fastify()
  t.teardown(fastify.close)

  fastify.register(expressPlugin)

  fastify.get('/', async (req, reply) => {
    t.equal(req.raw.originalUrl, req.raw.url)
    t.equal(req.raw.id, req.id)
    t.equal(req.raw.hostname, req.hostname)
    t.equal(req.raw.protocol, req.protocol)
    t.equal(req.raw.ip, req.ip)
    t.same(req.raw.ips, req.ips)
    t.ok(req.raw.log)
    t.ok(reply.raw.log)
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err) => {
      t.error(err)
    })
  })
})

test('trust proxy protocol', (t) => {
  t.plan(5)
  const fastify = Fastify({ trustProxy: true })

  t.teardown(fastify.close.bind(fastify))

  fastify.register(expressPlugin).after(() => {
    fastify.use('/', function (req, res) {
      t.equal(req.ip, '1.1.1.1', 'gets ip from x-forwarded-for')
      t.equal(req.hostname, 'example.com', 'gets hostname from x-forwarded-host')
      t.equal(req.protocol, 'lorem', 'gets protocol from x-forwarded-proto')

      res.sendStatus(200)
    })
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      headers: {
        'X-Forwarded-For': '1.1.1.1',
        'X-Forwarded-Host': 'example.com',
        'X-Forwarded-Proto': 'lorem'
      },
      url: address
    }, (err) => {
      t.error(err)
    })
  })
})

test('passing createProxyHandler sets up a Proxy with Express req', t => {
  t.plan(8)
  const testString = 'test proxy'

  const fastify = Fastify()
  fastify.register(expressPlugin, {
    createProxyHandler: () => ({
      set (target, prop, value) {
        if (prop === 'customField') {
          t.equal(value, testString)
        }

        return Reflect.set(target, prop, value)
      },
      get (target, prop) {
        if (prop === 'customField') {
          t.pass('get customField called')
        }

        return target[prop]
      }
    })
  })
    .after(() => {
      fastify.use(function (req, _res, next) {
        req.customField = testString
        t.equal(req.customField, testString)
        next()
      })
    })

  fastify.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  fastify.listen({ port: 0 }, err => {
    t.error(err)

    t.teardown(fastify.server.close.bind(fastify.server))

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 200)
      t.equal(response.headers['content-length'], '' + body.length)
      t.same(JSON.parse(body), { hello: 'world' })
    })
  })
})

test('createProxyHandler has access to Fastify request object', t => {
  t.plan(12)
  const startTestString = 'original'

  const fastify = Fastify()
  fastify.decorateRequest('getAndSetFastify', startTestString)
  fastify.decorateRequest('getOnlyFastify', startTestString)

  fastify.register(expressPlugin, {
    createProxyHandler: fastifyReq => ({
      set (target, prop, value) {
        if (prop === 'getAndSetFastify') {
          t.pass('set to Fastify called')
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
          t.pass('get from Fastify called')
          return fastifyReq[prop]
        }

        return target[prop]
      }
    })
  })
    .after(() => {
      fastify.use(function (req, _res, next) {
        t.equal(req.getAndSetFastify, startTestString)
        t.equal(req.getOnlyFastify, startTestString)
        req.getAndSetFastify = 'updated'
        req.getOnlyFastify = 'updated'
        next()
      })
    })

  fastify.get('/', function (request, reply) {
    // getOnlyFastify should change and getOnlyFastify should not
    t.equal(request.getAndSetFastify, 'updated')
    t.equal(request.getOnlyFastify, startTestString)

    reply.send({ hello: 'world' })
  })

  fastify.listen({ port: 0 }, err => {
    t.error(err)

    t.teardown(fastify.server.close.bind(fastify.server))

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 200)
      t.equal(response.headers['content-length'], '' + body.length)
      t.same(JSON.parse(body), { hello: 'world' })
    })
  })
})
