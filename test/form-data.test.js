'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const fastifyFormBody = require('@fastify/formbody')
const Express = require('express')
const bodyParser = require('body-parser')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('POST request without form body works', (t, done) => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      express.use(bodyParser.urlencoded({ extended: false }))
      fastify.use(express)
      fastify.use((req, res, next) => {
        // body-parser default value
        t.assert.deepStrictEqual(req.body, {})
        next()
      })
    })

  fastify.post('/hello', (req, reply) => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'post',
      url: address + '/hello',
      timeout: 100
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
      fastify.close()
      done()
    })
  })
})

test('POST request with form body and without body-parser works', (t, done) => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      fastify.use(express)
      fastify.use((req, res, next) => {
        // req.body default value
        t.assert.strictEqual(req.body, undefined)
        next()
      })
    })

  fastify.post('/hello', (req, reply) => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'post',
      url: address + '/hello',
      form: { input: 'test' },
      timeout: 100
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
      fastify.close()
      done()
    })
  })
})

test('POST request with form body and body-parser hangs up', (t, done) => {
  t.plan(3)
  const fastify = Fastify()
  const express = Express()

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      express.use(bodyParser.urlencoded({ extended: false }))
      fastify.use(express)
      fastify.use((req, res, next) => {
        // body-parser result
        t.assert.strictEqual(req.body.input, 'test')
        next()
      })
    })

  fastify.post('/hello', (req, reply) => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'post',
      url: address + '/hello',
      form: { input: 'test' },
      timeout: 100
    }, (err, res, data) => {
      t.assert.strictEqual(err.message, 'Request timed out')
      fastify.close()
      done()
    })
  })
})

test('POST request with form body and body-parser hangs up, compatibility case', (t, done) => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin, { expressHook: 'preHandler' })
    .after(() => {
      fastify.use(express)
      fastify.use((req, res, next) => {
        // fastify-formbody with backward compatibility result
        t.assert.deepStrictEqual(req.body.input, 'test')
        next()
      })
    })

  fastify.post('/hello', (req, reply) => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'post',
      url: address + '/hello',
      form: { input: 'test' },
      timeout: 100
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
      fastify.close()
      done()
    })
  })
})
