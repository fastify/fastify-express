'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const Express = require('express')

const expressPlugin = require('../index')

// Fastify runs the hooks of a plugin only for the requests it routes to that
// plugin, so an Express route in a plugin needs a prefix and a not-found
// handler of the plugin (see "Express routes inside a plugin" in the README).
async function buildServer (t, mount) {
  const fastify = Fastify()
  t.after(() => fastify.close())

  await fastify.register(expressPlugin)

  fastify.register(async function (instance) {
    mount(instance)
    instance.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ notFound: 'plugin' })
    })
  }, { prefix: '/legacy' })

  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ notFound: 'root' })
  })

  return fastify.listen({ port: 0 })
}

test('Serve an express application inside a prefixed plugin', async t => {
  t.plan(9)

  const app = Express()
  app.use(function (_req, res, next) {
    res.setHeader('x-custom', true)
    next()
  })
  app.get('/hello', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  const address = await buildServer(t, instance => {
    instance.use('/', app)
  })

  const hello = await fetch(address + '/legacy/hello')
  t.assert.deepStrictEqual(hello.status, 201)
  t.assert.deepStrictEqual(hello.headers.get('x-custom'), 'true')
  t.assert.deepStrictEqual(await hello.json(), { hello: 'world' })

  const missing = await fetch(address + '/legacy/missing')
  t.assert.deepStrictEqual(missing.status, 404)
  t.assert.deepStrictEqual(missing.headers.get('x-custom'), 'true')
  t.assert.deepStrictEqual(await missing.json(), { notFound: 'plugin' })

  const outside = await fetch(address + '/hello')
  t.assert.deepStrictEqual(outside.status, 404)
  t.assert.deepStrictEqual(outside.headers.get('x-custom'), null)
  t.assert.deepStrictEqual(await outside.json(), { notFound: 'root' })
})

test('Serve an express router inside a prefixed plugin', async t => {
  t.plan(4)

  const router = Express.Router()
  router.get('/hello', (_req, res) => {
    res.json({ hello: 'router' })
  })

  const address = await buildServer(t, instance => {
    instance.use('/', router)
  })

  const hello = await fetch(address + '/legacy/hello')
  t.assert.deepStrictEqual(hello.status, 200)
  t.assert.deepStrictEqual(await hello.json(), { hello: 'router' })

  const missing = await fetch(address + '/legacy/missing')
  t.assert.deepStrictEqual(missing.status, 404)
  t.assert.deepStrictEqual(await missing.json(), { notFound: 'plugin' })
})

test('An express application mounted without a path inside a prefixed plugin sees the prefixed URL', async t => {
  t.plan(3)

  const app = Express()
  app.get('/hello', (_req, res) => {
    res.json({ hello: 'world' })
  })
  app.get('/legacy/hello', (req, res) => {
    res.json({ url: req.url })
  })

  const address = await buildServer(t, instance => {
    instance.use(app)
  })

  const result = await fetch(address + '/legacy/hello')
  t.assert.deepStrictEqual(result.status, 200)
  t.assert.deepStrictEqual(await result.json(), { url: '/legacy/hello' })

  const outside = await fetch(address + '/hello')
  t.assert.deepStrictEqual(outside.status, 404)
})
