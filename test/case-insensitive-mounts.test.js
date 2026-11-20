'use strict'

const net = require('node:net')
const { test } = require('node:test')
const Fastify = require('fastify')
const express = require('express')

const expressPlugin = require('../index')

// Send the request target exactly as written.
function requestTarget (address, target) {
  const { hostname, port } = new URL(address)

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n\r\n`)
    })

    let response = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => { response += chunk })
    socket.on('end', () => {
      resolve({
        statusCode: Number(/^HTTP\/1\.1 (\d{3})/.exec(response)[1]),
        payload: response.slice(response.indexOf('\r\n\r\n') + 4)
      })
    })
    socket.on('error', reject)
  })
}

function deny (_req, res) {
  res.statusCode = 401
  res.end('auth required')
}

async function check (t, instance, expected) {
  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  for (const [target, statusCode, payload] of expected) {
    const response = await requestTarget(address, target)
    t.assert.strictEqual(response.statusCode, statusCode, target)
    if (payload !== undefined) {
      t.assert.strictEqual(response.payload, payload, target)
    }
  }
}

test('mount paths with characters that toLowerCase() folds differently match every spelling', async t => {
  const instance = Fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use('/İletişim/admin', deny)
  instance.use(['/STRAẞE', '/Keys'], deny)
  instance.get('/İletişim/admin/messages', async () => ({ secret: true }))
  instance.get('/STRAẞE/:id', async () => ({ secret: true }))
  instance.get('/keys/:id', async () => ({ secret: true }))

  instance.register(async function (scoped) {
    scoped.use('/admin', deny)
    scoped.get('/admin/:id', async () => ({ secret: true }))
  }, { prefix: '/İzmir' })

  await check(t, instance, [
    ['/%C4%B0leti%C5%9Fim/admin/messages', 401],
    ['/i%CC%87leti%C5%9Fim/admin/messages', 401],
    ['/STRA%E1%BA%9EE/1', 401],
    ['/stra%C3%9Fe/1', 401],
    ['/%E2%84%AAeys/1', 401],
    ['/keys/1', 401],
    ['/%C4%B0zmir/admin/1', 401],
    ['/i%CC%87zmir/ADMIN/1', 401]
  ])
})

test('folding a mount path keeps the case of its parameter names', async t => {
  const instance = Fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use('/Users/:userId{/:Tab}', (req, res) => {
    res.end(JSON.stringify(req.params))
  })
  instance.get('/Users/:id', async () => ({ secret: true }))
  instance.get('/Users/:id/:tab', async () => ({ secret: true }))

  await check(t, instance, [
    ['/users/42', 200, '{"userId":"42"}'],
    ['/USERS/42/Posts', 200, '{"userId":"42","Tab":"posts"}']
  ])
})

test('case-sensitive matchers that would skip a request fail closed', async t => {
  const instance = Fastify({ routerOptions: { caseSensitive: false, ignoreDuplicateSlashes: true } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const router = express.Router()
  router.use(/^\/Admin(?=\/|$)/, deny)
  instance.use(router)

  const strict = express.Router({ caseSensitive: true })
  strict.use('/Billing', deny)
  strict.use('/reports', deny)
  instance.use(strict)

  // The `i` flag does not fold `ẞ` as toLowerCase() does.
  instance.use(/^\/GRÜẞE/, deny)

  instance.get('/Admin/users', async () => ({ secret: true }))
  instance.get('/Billing/:invoice', async () => ({ secret: true }))
  instance.get('/Reports/:id', async () => ({ secret: true }))
  instance.get('/GRÜẞE/:id', async () => ({ secret: true }))

  await check(t, instance, [
    ['/Admin/users', 500],
    ['/admin/users', 500],
    ['/Billing/1', 500],
    ['//billing/1', 500],
    // A case-sensitive matcher that matches the lowercased path still runs.
    ['/Reports/1', 401],
    ['/reports/1', 401],
    ['/GR%C3%9C%E1%BA%9EE/1', 500]
  ])
})

test('routes that no case-sensitive matcher covers are served', async t => {
  const instance = Fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use((_req, _res, next) => next())
  instance.use('/admin', deny)

  const app = express()
  app.get('/Express', (_req, res) => res.end('express'))
  instance.use(app)

  // An application mounted inside another one cannot be looked into, so it is
  // left to Express.
  const inner = express.Router()
  inner.use('/Hidden', deny)
  const nested = express()
  nested.use(inner)
  const parent = express()
  parent.use(nested)
  instance.use(parent)

  instance.get('/Admin/users', async () => ({ secret: true }))
  instance.get('/Public/:id', async () => 'public')
  instance.get('/Hidden/:id', async () => ({ secret: true }))

  await check(t, instance, [
    ['/Admin/users', 401],
    ['/ADMIN/users', 401],
    ['/Public/A', 200, 'public'],
    ['/public/a', 200, 'public'],
    ['/express', 200, 'express'],
    ['/Hidden/1', 401],
    ['/hidden/1', 401]
  ])
})
