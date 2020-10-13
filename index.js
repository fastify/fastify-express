'use strict'

const fp = require('fastify-plugin')
const symbols = require('fastify/lib/symbols')
const Express = require('express')
const kMiddlewares = Symbol('fastify-express-middlewares')

function expressPlugin (fastify, options, next) {
  fastify.decorate('use', use)
  fastify[kMiddlewares] = []
  fastify.decorate('express', Express())
  fastify.express.disable('x-powered-by')

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
      this.express.use(path)
    } else {
      this.express.use(path, fn)
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
    next()
  }

  function runConnect (req, reply, next) {
    if (this[kMiddlewares].length > 0) {
      this.express(req.raw, reply.raw, next)
    } else {
      next()
    }
  }

  function onRegister (instance) {
    const middlewares = instance[kMiddlewares].slice()
    instance[kMiddlewares] = []
    instance.decorate('express', Express())
    instance.express.disable('x-powered-by')
    instance.decorate('use', use)
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
