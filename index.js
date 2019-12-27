'use strict'

const fp = require('fastify-plugin')
const Express = require('express')
const kMiddlewares = Symbol('fastify-express-middlewares')
const kExpress = Symbol('fastify-express-instance')

function expressPlugin (fastify, options, next) {
  // TODO: we should use decorate, but `use` is already
  // a public API of Fastify. In Fastify v3 it will be deprecated,
  // so we will able to use `decorate`
  fastify.use = use
  fastify[kMiddlewares] = []
  fastify[kExpress] = Express()

  fastify
    .addHook('onRequest', runConnect)
    .addHook('onSend', runOnSend)
    .addHook('onRegister', onRegister)

  function use (path, fn) {
    this[kMiddlewares].push([path, fn])
    if (fn == null) {
      this[kExpress].use(path)
    } else {
      this[kExpress].use(path, fn)
    }
    return this
  }

  function runConnect (req, reply, next) {
    if (this[kMiddlewares].length > 0) {
      this[kExpress](req.raw, reply.res, next)
    } else {
      next()
    }
  }

  function runOnSend (req, reply, payload, next) {
    reply.res.removeHeader('x-powered-by')
    next()
  }

  function onRegister (instance) {
    const middlewares = instance[kMiddlewares].slice()
    instance[kMiddlewares] = []
    instance[kExpress] = Express()
    instance.use = use
    for (const middleware of middlewares) {
      instance.use(...middleware)
    }
  }

  next()
}

module.exports = fp(expressPlugin, {
  // fastify: '>=3.0.0',
  name: 'fastify-express'
})
