'use strict'

const fp = require('fastify-plugin')
const Express = require('express')
// const kMiddlewares = Symbol('fastify-express-middlewares')
// const kExpress = Symbol('fastify-express-instance')

function expressPlugin (fastify, options, next) {
  // TODO: we should use decorate, but `use` is already
  // a public API of Fastify. In Fastify v3 it will be deprecated,
  // so we will able to use `decorate`
  fastify.use = use
  fastify
    .decorate('__middlewares', [])
    .decorate('__express', Express())
    .addHook('onRoute', onRoute)
    .addHook('onSend', runOnSend)
    .addHook('onRegister', onRegister)

  function use (path, fn) {
    this.__middlewares.push([path, fn])
    if (fn == null) {
      this.__express.use(path)
    } else {
      this.__express.use(path, fn)
    }
    return this
  }

  function runConnect (req, reply, next) {
    if (this.__middlewares.length > 0) {
      this.__express(req.raw, reply.res, next)
    } else {
      next()
    }
  }

  function onRoute (opts) {
    opts.onRequest = opts.onRequest || []
    if (!Array.isArray(opts.onRequest)) {
      opts.onRequest = [opts.onRequest]
    }
    opts.onRequest.push(runConnect)
  }

  function runOnSend (req, reply, payload, next) {
    reply.res.removeHeader('x-powered-by')
    next()
  }

  function onRegister (instance) {
    const middlewares = instance.__middlewares.slice()
    instance.__middlewares = []
    instance.__express = Express()
    instance.use = use
    for (const middleware of middlewares) {
      instance.use(...middleware)
    }
  }

  next()
}

module.exports = fp(expressPlugin, {
  fastify: '>=3.0.0',
  name: 'fastify-express'
})
