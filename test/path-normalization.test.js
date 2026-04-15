'use strict'

const { test } = require('node:test')
const fastify = require('fastify')

const expressPlugin = require('../index')

test('ignoreDuplicateSlashes does not bypass path-scoped middleware', async t => {
  t.plan(3)

  const instance = fastify({
    routerOptions: {
      ignoreDuplicateSlashes: true
    }
  })

  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  instance.use('/admin', function (req, res, next) {
    middlewareCalls++

    if (req.headers.authorization !== 'Bearer admin-secret-token') {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'Forbidden by Express middleware' }))
      return
    }

    next()
  })

  instance.get('/admin/dashboard', async () => {
    return { secret: 'classified' }
  })

  const address = await instance.listen({ port: 0 })

  const normalRequest = await fetch(address + '/admin/dashboard')
  t.assert.deepStrictEqual(normalRequest.status, 403)

  const bypassAttempt = await fetch(address + '//admin/dashboard')
  t.assert.deepStrictEqual(bypassAttempt.status, 403)

  t.assert.deepStrictEqual(middlewareCalls, 2)
})

test('useSemicolonDelimiter does not bypass path-scoped middleware', async t => {
  t.plan(5)

  const instance = fastify({
    routerOptions: {
      useSemicolonDelimiter: true
    }
  })

  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let middlewareCalls = 0

  instance.use('/admin', function (req, res, next) {
    middlewareCalls++

    if (req.headers.authorization !== 'Bearer admin-secret-token') {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'Forbidden by Express middleware' }))
      return
    }

    next()
  })

  instance.get('/admin', async () => {
    return { secret: 'classified' }
  })

  const address = await instance.listen({ port: 0 })

  const normalRequest = await fetch(address + '/admin')
  t.assert.deepStrictEqual(normalRequest.status, 403)

  const withQueryString = await fetch(address + '/admin?foo=bar')
  t.assert.deepStrictEqual(withQueryString.status, 403)

  const withSemicolonInQuery = await fetch(address + '/admin?foo=bar;baz=1')
  t.assert.deepStrictEqual(withSemicolonInQuery.status, 403)

  const bypassAttempt = await fetch(address + '/admin;bypass')
  t.assert.deepStrictEqual(bypassAttempt.status, 403)

  t.assert.deepStrictEqual(middlewareCalls, 4)
})
