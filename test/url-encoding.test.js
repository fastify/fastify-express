'use strict'

const net = require('node:net')
const { test } = require('node:test')
const Fastify = require('fastify')
const express = require('express')

const expressPlugin = require('../index')

// Send the request target exactly as written: fetch() and http.request()
// would normalize backslashes or drop the fragment.
function requestTarget (address, target) {
  const { hostname, port } = new URL(address)

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port }, () => {
      // Do not half-close the connection: Node.js aborts a request still in
      // flight when the client ends its side, so its response would be lost.
      // The server closes the connection after responding (Connection: close).
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

function deny (req, res) {
  res.statusCode = 401
  res.end('auth required')
}

test('a backslash with whitespace or a fragment does not bypass mounts on dynamic segments', async t => {
  const instance = Fastify({ routerOptions: { useSemicolonDelimiter: true } })
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  instance.use('/tenant/:id/admin', deny)
  instance.get('/tenant/:id/admin', async () => ({ secret: true }))

  instance.use(/^\/regexp\/[^/]+\/admin/, deny)
  instance.get('/regexp/:id/admin', async () => ({ secret: true }))

  const router = express.Router()
  router.use('/router/:id/admin', deny)
  instance.use(router)
  instance.get('/router/:id/admin', async () => ({ secret: true }))

  instance.register(async function (scoped) {
    scoped.use('/admin', deny)
    scoped.get('/admin', async () => ({ secret: true }))
  }, { prefix: '/scoped/:id' })

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })

  for (const base of ['/tenant', '/regexp', '/router', '/scoped']) {
    for (const rest of [
      '/x/admin',
      '/x%5C%20/admin',
      '/x%5C%09/admin',
      '/x%5C%0A/admin',
      '/x%5C%0C/admin',
      '/x%5C%0D/admin',
      '/x%5C%C2%A0/admin',
      '/x%5C%EF%BB%BF/admin',
      '/x%5C/admin?a=%20',
      '/x%5C/admin;a=%20',
      '/x%5C/admin?a=1#b',
      '/x%5C/admin#',
      '/x\\%20/admin',
      '/x\\/admin#fragment'
    ]) {
      const response = await requestTarget(address, base + rest)
      t.assert.strictEqual(response.statusCode, 401, base + rest)
    }
  }
})

test('middleware and route handlers decode parameters and the query string once', async t => {
  const instance = Fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  let seen
  instance.use('/account/:id', (req, res, next) => {
    seen = { id: req.params.id, query: { ...req.query } }
    next()
  })
  instance.get('/account/:id', async request => ({ id: request.params.id, query: request.query }))

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })

  for (const [target, id, query] of [
    ['/account/alice', 'alice', {}],
    ['/account/%2561lice', '%61lice', {}],
    ['/account/%252F', '%2F', {}],
    ['/account/a%2Fb', 'a/b', {}],
    ['/account/a%20b%5C', 'a b\\', {}],
    ['/account/alice?next=%2525&name=a%20b', 'alice', { next: '%25', name: 'a b' }],
    ['/account/alice?q=1#2', 'alice', { q: '1#2' }]
  ]) {
    seen = undefined
    const response = await requestTarget(address, target)
    t.assert.strictEqual(response.statusCode, 200, target)
    t.assert.deepStrictEqual(JSON.parse(response.payload), { id, query }, target)
    t.assert.deepStrictEqual(seen, { id, query }, target)
  }
})

test('mount paths are spelled like Fastify routes', async t => {
  const instance = Fastify()
  t.after(() => instance.close())

  await instance.register(expressPlugin)

  instance.use('/team docs', deny)
  instance.get('/team docs', async () => ({ secret: true }))

  instance.use(['/100%', '/a\u00a0b'], deny)
  instance.get('/100%', async () => ({ secret: true }))
  instance.get('/a\u00a0b', async () => ({ secret: true }))

  instance.register(async function (scoped) {
    scoped.use('/admin', deny)
    scoped.get('/admin', async () => ({ secret: true }))
  }, { prefix: '/shared files' })

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })

  for (const target of ['/team%20docs', '/100%25', '/a%C2%A0b', '/shared%20files/admin']) {
    const response = await requestTarget(address, target)
    t.assert.strictEqual(response.statusCode, 401, target)
  }
})
