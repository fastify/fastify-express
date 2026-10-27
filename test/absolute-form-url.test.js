'use strict'

const net = require('node:net')
const { test } = require('node:test')
const Fastify = require('fastify')

const expressPlugin = require('../index')

function requestTarget (address, target, method = 'GET') {
  const { hostname, port } = new URL(address)

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port }, () => {
      socket.end(`${method} ${target} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n\r\n`)
    })

    let response = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => { response += chunk })
    socket.on('end', () => {
      const status = /^HTTP\/1\.1 (\d{3})/.exec(response)
      resolve({
        statusCode: Number(status[1]),
        payload: response.slice(response.indexOf('\r\n\r\n') + 4)
      })
    })
    socket.on('error', reject)
  })
}

test('absolute-form targets do not bypass path-scoped middleware', async t => {
  const instance = Fastify({
    routerOptions: {
      ignoreDuplicateSlashes: true,
      useSemicolonDelimiter: true
    }
  })
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  const seen = []
  let middlewareCalls = 0

  instance.use((req, res, next) => {
    seen.push({ url: req.url, originalUrl: req.originalUrl })
    next()
  })
  instance.use('/admin', (req, res) => {
    middlewareCalls++
    res.statusCode = 403
    res.end('blocked')
  })
  instance.get('/admin/:section', async () => ({ secret: 'classified' }))

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  const targets = [
    'http://localhost/admin/dashboard',
    'HTTP://localhost/admin/dashboard',
    'https://user:pass@example.test:443/admin/dashboard?test=%76alue',
    'http://example.test//admin//dashboard',
    'http://localhost/admin/dashboard;bypass'
  ]

  for (const target of targets) {
    const response = await requestTarget(address, target)
    t.assert.strictEqual(response.statusCode, 403, target)
  }

  t.assert.strictEqual(middlewareCalls, targets.length)
  t.assert.deepStrictEqual(seen, [
    { url: '/admin/dashboard', originalUrl: targets[0] },
    { url: '/admin/dashboard', originalUrl: targets[1] },
    { url: '/admin/dashboard?test=value', originalUrl: targets[2] },
    { url: '/admin/dashboard', originalUrl: targets[3] },
    { url: '/admin/dashboard?bypass', originalUrl: targets[4] }
  ])
})

test('absolute-form targets match middleware in prefixed plugins', async t => {
  const instance = Fastify({
    routerOptions: {
      ignoreDuplicateSlashes: true
    }
  })
  t.after(() => instance.close())

  await instance.register(expressPlugin)
  await instance.register(async child => {
    child.use('/admin', (req, res) => {
      res.statusCode = 403
      res.end('blocked')
    })
    child.get('/admin/:id', async () => ({ secret: 'classified' }))
  }, { prefix: '/api' })

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  const response = await requestTarget(address, 'http://localhost/api//admin/42')

  t.assert.strictEqual(response.statusCode, 403)
})

test('absolute-form targets are resolved when duplicate slash normalization is disabled', async t => {
  const instance = Fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  instance.use('/admin', (req, res) => {
    res.statusCode = 403
    res.end('blocked')
  })
  instance.get('/admin/dashboard', async () => ({ secret: 'classified' }))

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  const response = await requestTarget(address, 'http://localhost/admin/dashboard')

  t.assert.strictEqual(response.statusCode, 403)
})

test('absolute-form targets without a path resolve to root and preserve the query', async t => {
  const instance = Fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  const seen = []
  instance.use((req, res, next) => {
    seen.push(req.url)
    next()
  })
  instance.get('/', async () => ({ ok: true }))
  instance.setNotFoundHandler(async () => ({ ok: true }))

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })

  t.assert.strictEqual((await requestTarget(address, 'http://example.test')).statusCode, 200)
  t.assert.strictEqual((await requestTarget(address, 'http://example.test?next=/admin&x=%76alue')).statusCode, 200)
  t.assert.strictEqual((await requestTarget(address, '*', 'OPTIONS')).statusCode, 200)
  t.assert.deepStrictEqual(seen, ['/', '/?next=/admin&x=value', '*'])
})

test('malformed request targets are rejected without affecting later requests', async t => {
  const instance = Fastify({
    routerOptions: {
      ignoreDuplicateSlashes: true
    }
  })
  t.after(() => instance.close())

  await instance.register(expressPlugin, {
    createProxyHandler: request => ({
      get (target, property, receiver) {
        if (property === 'url' && request.headers['x-test-url']) {
          return request.headers['x-test-url']
        }
        return Reflect.get(target, property, receiver)
      }
    })
  })

  instance.use((req, res, next) => next())
  instance.get('/admin', async () => ({ ok: true }))

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  const malformedTargets = [
    'http:///admin',
    'http://example.test:invalid/admin',
    'http://example.test#fragment/admin',
    '/admin?value=%zz'
  ]

  for (const target of malformedTargets) {
    const response = await requestTarget(address, target)
    t.assert.strictEqual(response.statusCode, 400, target)
  }

  for (const target of ['http:///admin', '/admin?value=%zz']) {
    const response = await instance.inject({
      method: 'GET',
      url: '/admin',
      headers: { 'x-test-url': target }
    })
    t.assert.strictEqual(response.statusCode, 400, target)
  }

  const validResponse = await requestTarget(address, '/admin')
  t.assert.strictEqual(validResponse.statusCode, 200)
})
