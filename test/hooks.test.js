'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const express = require('express')
const expressPlugin = require('../index')

test('express error middlewares chained via next(err) must not crash the process when the first middleware already sent a response', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(expressPlugin)

  const app = express()

  app.get('/foo', (_req, _res, next) => {
    next(new Error('route error'))
  })

  // First error middleware: send a response, then pass the error along.
  app.use((err, _req, res, next) => {
    res.status(500).json({ error: err.message })
    next(err)
  })

  // Second error middleware: should skip sending because headersSent is true.
  app.use((err, _req, res, _next) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'fallback' })
    }
  })

  fastify.use(app)

  const address = await fastify.listen({ port: 0 })
  const result = await fetch(`${address}/foo`)
  t.assert.deepStrictEqual(result.status, 500)
  t.assert.deepStrictEqual(await result.json(), { error: 'route error' })
})

test('express error middleware that sends unconditionally must not crash the process after the first send', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(expressPlugin)

  const app = express()

  app.get('/bar', (_req, _res, next) => {
    next(new Error('route error'))
  })

  // First error middleware sends and forwards the error.
  app.use((err, _req, res, next) => {
    res.status(500).json({ error: err.message })
    next(err)
  })

  // Second error middleware sends unconditionally — exercises the replySent guard.
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'should be blocked by replySent guard' })
  })

  fastify.use(app)

  const address = await fastify.listen({ port: 0 })
  const result = await fetch(`${address}/bar`)
  t.assert.deepStrictEqual(result.status, 500)
  t.assert.deepStrictEqual(await result.json(), { error: 'route error' })
})

test('onSend hook should receive valid request and reply objects if middleware fails', async t => {
  t.plan(3)
  const fastify = Fastify()
  fastify.register(expressPlugin)
    .after(() => {
      fastify.use(function (_req, _res, next) {
        next(new Error('middlware failed'))
      })
    })

  fastify.decorateRequest('testDecorator', 'testDecoratorVal')
  fastify.decorateReply('testDecorator', 'testDecoratorVal')

  fastify.addHook('onSend', function (request, reply, _payload, next) {
    t.assert.deepStrictEqual(request.testDecorator, 'testDecoratorVal')
    t.assert.deepStrictEqual(reply.testDecorator, 'testDecoratorVal')
    next()
  })

  fastify.get('/', (_req, reply) => {
    reply.send('hello')
  })

  const result = await fastify.inject({
    method: 'GET',
    url: '/'
  })

  t.assert.deepStrictEqual(result.statusCode, 500)
})

test('request.url is not mutated between onRequest and onResponse', async t => {
  t.plan(3)
  const fastify = Fastify()
  const targetUrl = '/hubba/bubba'

  fastify.addHook('onRequest', (request, _, next) => {
    t.assert.deepStrictEqual(request.url, targetUrl)
    next()
  })

  fastify.addHook('onResponse', (request, _, next) => {
    t.assert.deepStrictEqual(request.url, targetUrl)
    next()
  })

  fastify.register(expressPlugin).after(() => {
    const mainRouter = express.Router()
    const innerRouter = express.Router()
    mainRouter.use('/hubba', innerRouter)
    innerRouter.get('/bubba', (_req, res) => {
      res.sendStatus(200)
    })
    fastify.use(mainRouter)
  })

  const result = await fastify.inject({
    method: 'GET',
    url: targetUrl
  })

  t.assert.deepStrictEqual(result.statusCode, 200)
})
