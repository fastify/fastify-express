'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')

const expressPlugin = require('../index')

test('Should enhance the Node.js core request/response objects', async t => {
  t.plan(8)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(expressPlugin)

  fastify.get('/', async (req, reply) => {
    t.assert.deepStrictEqual(req.raw.originalUrl, req.raw.url)
    t.assert.deepStrictEqual(req.raw.id, req.id)
    t.assert.deepStrictEqual(req.raw.hostname, req.hostname)
    t.assert.deepStrictEqual(req.raw.protocol, req.protocol)
    t.assert.deepStrictEqual(req.raw.ip, req.ip)
    t.assert.deepStrictEqual(req.raw.ips, req.ips)
    t.assert.ok(req.raw.log)
    t.assert.ok(reply.raw.log)
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  await fetch(address)
})

test('trust proxy protocol', async (t) => {
  t.plan(3)
  const fastify = Fastify({ trustProxy: true })

  t.after(() => fastify.close())

  fastify.register(expressPlugin).after(() => {
    fastify.use('/', function (req, res) {
      t.assert.deepStrictEqual(req.ip, '1.1.1.1', 'gets ip from x-forwarded-for')
      t.assert.deepStrictEqual(req.hostname, 'example.com', 'gets hostname from x-forwarded-host')
      t.assert.deepStrictEqual(req.protocol, 'lorem', 'gets protocol from x-forwarded-proto')

      res.sendStatus(200)
    })
  })

  const address = await fastify.listen({ port: 0 })

  await fetch(address, {
    headers: {
      'X-Forwarded-For': '1.1.1.1',
      'X-Forwarded-Host': 'example.com',
      'X-Forwarded-Proto': 'lorem'
    }
  })
})

test('passing createProxyHandler sets up a Proxy with Express req', async t => {
  t.plan(6)
  const testString = 'test proxy'

  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.register(expressPlugin, {
    createProxyHandler: () => ({
      set (target, prop, value) {
        if (prop === 'customField') {
          t.assert.deepStrictEqual(value, testString)
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
      fastify.use(function (req, _res, next) {
        req.customField = testString
        t.assert.deepStrictEqual(req.customField, testString)
        next()
      })
    })

  fastify.get('/', function (_request, reply) {
    reply.send({ hello: 'world' })
  })

  const address = await fastify.listen({ port: 0 })

  const response = await fetch(address)

  const responseText = await response.text()
  t.assert.deepStrictEqual(response.status, 200)
  t.assert.deepStrictEqual(response.headers.get('content-length'), '' + responseText.length)
  t.assert.deepStrictEqual(JSON.parse(responseText), { hello: 'world' })
})

test('createProxyHandler has access to Fastify request object', async t => {
  t.plan(10)
  const startTestString = 'original'

  const fastify = Fastify()
  t.after(() => fastify.close())
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
      fastify.use(function (req, _res, next) {
        t.assert.deepStrictEqual(req.getAndSetFastify, startTestString)
        t.assert.deepStrictEqual(req.getOnlyFastify, startTestString)
        req.getAndSetFastify = 'updated'
        req.getOnlyFastify = 'updated'
        next()
      })
    })

  fastify.get('/', function (request, reply) {
    // getOnlyFastify should change and getOnlyFastify should not
    t.assert.deepStrictEqual(request.getAndSetFastify, 'updated')
    t.assert.deepStrictEqual(request.getOnlyFastify, startTestString)

    reply.send({ hello: 'world' })
  })

  const address = await fastify.listen({ port: 0 })

  const response = await fetch(address)

  const responseText = await response.text()
  t.assert.deepStrictEqual(response.status, 200)
  t.assert.deepStrictEqual(response.headers.get('content-length'), '' + responseText.length)
  t.assert.deepStrictEqual(JSON.parse(responseText), { hello: 'world' })
})
