'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const Express = require('express')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('Register express application', (t, done) => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()

  express.use(function (req, res, next) {
    res.setHeader('x-custom', true)
    next()
  })

  express.get('/hello', (req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify.register(expressPlugin)
    .after(() => { fastify.use(express) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address + '/hello'
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 201)
      t.assert.strictEqual(res.headers['x-custom'], 'true')
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
      fastify.close()
      done()
    })
  })
})

test('Register express application that uses Router', (t, done) => {
  t.plan(9)
  const fastify = Fastify()

  const router = Express.Router()

  router.use(function (req, res, next) {
    res.setHeader('x-custom', true)
    next()
  })

  router.get('/hello', (req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  router.get('/foo', (req, res) => {
    res.status(400)
    res.json({ foo: 'bar' })
  })

  fastify.register(expressPlugin)
    .after(() => { fastify.use(router) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address + '/hello'
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 201)
      t.assert.strictEqual(res.headers['x-custom'], 'true')
      t.assert.deepStrictEqual(JSON.parse(data), { hello: 'world' })
    })
    sget({
      method: 'GET',
      url: address + '/foo'
    }, (err, res, data) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.statusCode, 400)
      t.assert.strictEqual(res.headers['x-custom'], 'true')
      t.assert.deepStrictEqual(JSON.parse(data), { foo: 'bar' })
      fastify.close()
      done()
    })
  })
})

test('Should remove x-powered-by header', (t, done) => {
  t.plan(3)
  const fastify = Fastify()

  const router = Express.Router()

  router.get('/', (req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.headers['x-powered-by'], undefined)
      fastify.close()
      done()
    })
  })
})

test('Should expose the express app on the fastify instance', (t, done) => {
  t.plan(3)
  const fastify = Fastify()

  const router = Express.Router()

  router.get('/', (req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res) => {
      t.assert.ifError(err)
      t.assert.strictEqual(fastify.express.disabled('x-powered-by'), true)
      fastify.close()
      done()
    })
  })
})

test('Should flush headers if express handles request', (t, done) => {
  t.plan(3)
  const fastify = Fastify()

  fastify.addHook('onRequest', (_, reply, done) => {
    reply.header('foo', 'bar')

    done()
  })

  const router = Express.Router()

  router.get('/', (req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.assert.ifError(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res) => {
      t.assert.ifError(err)
      t.assert.strictEqual(res.headers.foo, 'bar')
      fastify.close()
      done()
    })
  })
})
