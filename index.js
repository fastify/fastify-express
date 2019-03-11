'use strict'

const fp = require('fastify-plugin')
const Express = require('express')

function expressPlugin (fastify, options, next) {
  const express = Express()

  // TODO: we should use decorate, but `use` is already
  // a public API of Fastify. In Fastify v3 it will be deprecated,
  // so we will able to use `decorate`
  fastify.use = use
  fastify.addHook('onRequest', runConnect)

  function use (path, fn) {
    if (fn == null) {
      express.use(path)
    } else {
      express.use(path, fn)
    }
    return this
  }

  function runConnect (req, reply, next) {
    express(req.raw, reply.res, next)
  }

  next()
}

module.exports = fp(expressPlugin, {
  fastify: '>=2.x',
  name: 'fastify-express'
})
