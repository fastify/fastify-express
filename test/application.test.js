'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const Express = require('express')

const expressPlugin = require('../index')

test('Register express application', async t => {
  t.plan(3)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  express.use(function (_req, res, next) {
    res.setHeader('x-custom', true)
    next()
  })

  express.get('/hello', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify.register(expressPlugin)
    .after(() => { fastify.use(express) })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/hello')

  t.assert.deepStrictEqual(result.status, 201)
  t.assert.deepStrictEqual(result.headers.get('x-custom'), 'true')
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('Register express application that uses Router', async t => {
  t.plan(6)
  const fastify = Fastify()
  t.after(() => fastify.close())

  const router = Express.Router()

  router.use(function (_req, res, next) {
    res.setHeader('x-custom', true)
    next()
  })

  router.get('/hello', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  router.get('/foo', (_req, res) => {
    res.status(400)
    res.json({ foo: 'bar' })
  })

  fastify.register(expressPlugin)
    .after(() => { fastify.use(router) })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/hello')

  t.assert.deepStrictEqual(result.status, 201)
  t.assert.deepStrictEqual(result.headers.get('x-custom'), 'true')
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })

  const result2 = await fetch(address + '/foo')

  t.assert.deepStrictEqual(result2.status, 400)
  t.assert.deepStrictEqual(result2.headers.get('x-custom'), 'true')
  t.assert.deepStrictEqual(await result2.json(), { foo: 'bar' })
})

test('Should remove x-powered-by header', async t => {
  t.plan(1)
  const fastify = Fastify()
  t.after(() => fastify.close())

  const router = Express.Router()

  router.get('/', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.headers.get('x-powered-by'), null)
})

test('Should expose the express app on the fastify instance', async t => {
  t.plan(1)
  const fastify = Fastify()
  t.after(() => fastify.close())

  const router = Express.Router()

  router.get('/', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  const address = await fastify.listen({ port: 0 })

  await fetch(address)
  t.assert.deepStrictEqual(fastify.express.disabled('x-powered-by'), true)
})

test('Should flush headers if express handles request', async t => {
  t.plan(1)
  const fastify = Fastify()
  t.after(() => fastify.close())

  fastify.addHook('onRequest', (_, reply, done) => {
    reply.header('foo', 'bar')

    done()
  })

  const router = Express.Router()

  router.get('/', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address)
  t.assert.deepStrictEqual(result.headers.get('foo'), 'bar')
})
