'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const fastifyFormBody = require('@fastify/formbody')
const Express = require('express')
const bodyParser = require('body-parser')

const expressPlugin = require('../index')

test('POST request without form body works', async t => {
  t.plan(3)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      express.use(bodyParser.urlencoded({ extended: false }))
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // body-parser default value
        t.assert.deepStrictEqual(req.body, {})
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/hello', {
    method: 'post',
    signal: AbortSignal.timeout(100)
  })

  t.assert.deepStrictEqual(result.status, 200)
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('POST request with form body and without body-parser works', async t => {
  t.plan(3)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // req.body default value
        t.assert.deepStrictEqual(req.body, undefined)
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/hello', {
    method: 'post',
    body: new URLSearchParams({ input: 'test' }),
    signal: AbortSignal.timeout(100)
  })

  t.assert.deepStrictEqual(result.status, 200)
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})

test('POST request with form body and body-parser hangs up', async t => {
  t.plan(2)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      express.use(bodyParser.urlencoded({ extended: false }))
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // body-parser result
        t.assert.deepStrictEqual(req.body, { input: 'test' })
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  await t.assert.rejects(() => fetch(address + '/hello', {
    method: 'post',
    body: new URLSearchParams({ input: 'test' }),
    signal: AbortSignal.timeout(5)
  }), 'Request timed out')
})

test('POST request with form body and body-parser hangs up, compatibility case', async t => {
  t.plan(3)
  const fastify = Fastify()
  const express = Express()
  t.after(() => fastify.close())

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin, { expressHook: 'preHandler' })
    .after(() => {
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // fastify-formbody with backward compatibility result
        t.assert.deepStrictEqual(req.body.input, 'test')
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  const address = await fastify.listen({ port: 0 })

  const result = await fetch(address + '/hello', {
    method: 'post',
    body: new URLSearchParams({ input: 'test' }),
    signal: AbortSignal.timeout(100)
  })

  t.assert.deepStrictEqual(result.status, 200)
  t.assert.deepStrictEqual(await result.json(), { hello: 'world' })
})
