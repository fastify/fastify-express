'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const express = require('express')
const expressPlugin = require('../index')

test('onSend hook should receive valid request and reply objects if middleware fails', t => {
  t.plan(4)
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
    t.equal(request.testDecorator, 'testDecoratorVal')
    t.equal(reply.testDecorator, 'testDecoratorVal')
    next()
  })

  fastify.get('/', (_req, reply) => {
    reply.send('hello')
  })

  fastify.inject({
    method: 'GET',
    url: '/'
  }, (err, res) => {
    t.error(err)
    t.equal(res.statusCode, 500)
  })
})

test('request.url is not mutated between onRequest and onResponse', t => {
  t.plan(4)
  const fastify = Fastify()
  const targetUrl = '/hubba/bubba'

  fastify.addHook('onRequest', (request, _, next) => {
    t.equal(request.url, targetUrl)
    next()
  })

  fastify.addHook('onResponse', (request, _, next) => {
    t.equal(request.url, targetUrl)
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

  fastify.inject({
    method: 'GET',
    url: targetUrl
  }, (err, res) => {
    t.error(err)
    t.equal(res.statusCode, 200)
  })
})
