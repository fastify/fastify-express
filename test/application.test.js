'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const Express = require('express')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('Register express application', t => {
  t.plan(5)
  const fastify = Fastify()
  const express = Express()
  t.teardown(fastify.close)

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

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address + '/hello'
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 201)
      t.match(res.headers, { 'x-custom': 'true' })
      t.same(JSON.parse(data), { hello: 'world' })
    })
  })
})

test('Register express application that uses Router', t => {
  t.plan(9)
  const fastify = Fastify()
  t.teardown(fastify.close)

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

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address + '/hello'
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 201)
      t.match(res.headers, { 'x-custom': 'true' })
      t.same(JSON.parse(data), { hello: 'world' })
    })
    sget({
      method: 'GET',
      url: address + '/foo'
    }, (err, res, data) => {
      t.error(err)
      t.equal(res.statusCode, 400)
      t.match(res.headers, { 'x-custom': 'true' })
      t.same(JSON.parse(data), { foo: 'bar' })
    })
  })
})

test('Should remove x-powered-by header', t => {
  t.plan(3)
  const fastify = Fastify()
  t.teardown(fastify.close)

  const router = Express.Router()

  router.get('/', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res) => {
      t.error(err)
      t.equal(res.headers['x-powered-by'], undefined)
    })
  })
})

test('Should expose the express app on the fastify instance', t => {
  t.plan(3)
  const fastify = Fastify()
  t.teardown(fastify.close)

  const router = Express.Router()

  router.get('/', (_req, res) => {
    res.status(201)
    res.json({ hello: 'world' })
  })

  fastify
    .register(expressPlugin)
    .after(() => { fastify.use(router) })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err) => {
      t.error(err)
      t.equal(fastify.express.disabled('x-powered-by'), true)
    })
  })
})

test('Should flush headers if express handles request', t => {
  t.plan(3)
  const fastify = Fastify()
  t.teardown(fastify.close)

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

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res) => {
      t.error(err)
      t.equal(res.headers.foo, 'bar')
    })
  })
})
