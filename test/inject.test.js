'use strict'

const { test } = require('node:test')
const { Readable } = require('node:stream')
const Fastify = require('fastify')
const Express = require('express')

const expressPlugin = require('../index')

test('inject returns the payload of an express application route', async t => {
  t.plan(4)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  express.get('/hello', (_req, res) => {
    res.setHeader('x-custom', 'true')
    res.status(201)
    res.json({ hello: 'world' })
  })

  await fastify.register(expressPlugin)
  fastify.use(express)

  const response = await fastify.inject('/hello')

  t.assert.strictEqual(response.statusCode, 201)
  t.assert.strictEqual(response.headers['x-custom'], 'true')
  t.assert.strictEqual(response.headers['content-type'], 'application/json; charset=utf-8')
  t.assert.deepStrictEqual(response.json(), { hello: 'world' })
})

test('inject returns the payload of an express router using res.send and res.end', async t => {
  t.plan(4)
  const fastify = Fastify()
  const router = Express.Router()
  t.after(() => fastify.close())

  router.get('/send', (_req, res) => {
    res.send('hello send')
  })
  router.get('/end', (_req, res) => {
    res.end('hello end')
  })

  await fastify.register(expressPlugin)
  fastify.use(router)

  const send = await fastify.inject('/send')
  t.assert.strictEqual(send.statusCode, 200)
  t.assert.strictEqual(send.payload, 'hello send')

  const end = await fastify.inject('/end')
  t.assert.strictEqual(end.statusCode, 200)
  t.assert.strictEqual(end.payload, 'hello end')
})

test('inject sends the request body to an express route', async t => {
  t.plan(2)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  express.post('/echo', Express.json(), (req, res) => {
    res.json(req.body)
  })

  await fastify.register(expressPlugin)
  fastify.use(express)

  const response = await fastify.inject({
    method: 'POST',
    url: '/echo',
    payload: { hello: 'world' }
  })

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.deepStrictEqual(response.json(), { hello: 'world' })
})

test('inject returns the payload of a fastify route behind express middleware', async t => {
  t.plan(3)
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(expressPlugin)
  fastify.use((_req, res, next) => {
    res.setHeader('x-middleware', 'true')
    next()
  })

  fastify.get('/json', async () => ({ hello: 'world' }))

  const response = await fastify.inject('/json')

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.strictEqual(response.headers['x-middleware'], 'true')
  t.assert.deepStrictEqual(response.json(), { hello: 'world' })
})

test('inject returns a streamed payload of a fastify route behind express middleware', async t => {
  t.plan(2)
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(expressPlugin)
  fastify.use((_req, _res, next) => next())

  fastify.get('/stream', (_request, reply) => {
    reply.type('text/plain').send(Readable.from(['hello ', 'stream']))
  })

  const response = await fastify.inject('/stream')

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.strictEqual(response.payload, 'hello stream')
})
