'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const fastifyFormBody = require('@fastify/formbody')
const Express = require('express')
const bodyParser = require('body-parser')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('POST request without form body works', t => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()
  t.teardown(fastify.close)

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      express.use(bodyParser.urlencoded({ extended: false }))
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // body-parser default value
        t.same(req.body, {})
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'post',
      url: address + '/hello',
      timeout: 100
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(data), { hello: 'world' })
    })
  })
})

test('POST request with form body and without body-parser works', t => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()
  t.teardown(fastify.close)

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // req.body default value
        t.equal(req.body, undefined)
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'post',
      url: address + '/hello',
      form: { input: 'test' },
      timeout: 100
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(data), { hello: 'world' })
    })
  })
})

test('POST request with form body and body-parser hangs up', t => {
  t.plan(3)
  const fastify = Fastify()
  const express = Express()
  t.teardown(fastify.close)

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin)
    .after(() => {
      express.use(bodyParser.urlencoded({ extended: false }))
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // body-parser result
        t.same(req.body, { input: 'test' })
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'post',
      url: address + '/hello',
      form: { input: 'test' },
      timeout: 100
    }, (err) => {
      t.equal(err.message, 'Request timed out')
    })
  })
})

test('POST request with form body and body-parser hangs up, compatibility case', t => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()
  t.teardown(fastify.close)

  fastify.register(fastifyFormBody)
  fastify.register(expressPlugin, { expressHook: 'preHandler' })
    .after(() => {
      fastify.use(express)
      fastify.use((req, _res, next) => {
        // fastify-formbody with backward compatibility result
        t.same(req.body, { input: 'test' })
        next()
      })
    })

  fastify.post('/hello', () => {
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'post',
      url: address + '/hello',
      form: { input: 'test' },
      timeout: 100
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(data), { hello: 'world' })
    })
  })
})
