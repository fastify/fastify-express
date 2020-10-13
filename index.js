'use strict'

const fp = require('fastify-plugin')
const symbols = require('fastify/lib/symbols')
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
  fastify[kExpress].disable('x-powered-by')

  fastify
    .addHook('onRequest', enhanceRequest)
    .addHook('onRequest', runConnect)
    .addHook('onRegister', onRegister)

  function use (path, fn) {
    if (typeof path === 'string') {
      const prefix = this[symbols.kRoutePrefix]
      path = prefix + (path === '/' && prefix.length > 0 ? '' : path)
    }
    this[kMiddlewares].push([path, fn])
    if (fn == null) {
      this[kExpress].use(path)
    } else {
      this[kExpress].use(path, fn)
    }
    return this
  }

  function enhanceRequest (req, reply, next) {
    req.raw.originalUrl = req.raw.url
    req.raw.id = req.id
    req.raw.hostname = req.hostname
    req.raw.ip = req.ip
    req.raw.ips = req.ips
    req.raw.log = req.log
    reply.raw.log = req.log
    // added in Fastify@3.5
    if (req.protocol) {
      req.raw.protocol = req.protocol
    }
    next()
  }

  function runConnect (req, reply, next) {
    if (this[kMiddlewares].length > 0) {
      this[kExpress](req.raw, reply.raw, next)
    } else {
      next()
    }
  }

  function onRegister (instance) {
    const middlewares = instance[kMiddlewares].slice()
    instance[kMiddlewares] = []
    instance[kExpress] = Express()
    instance[kExpress].disable('x-powered-by')
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
