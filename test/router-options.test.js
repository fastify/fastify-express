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
      resolve({ statusCode: Number(/^HTTP\/1\.1 (\d{3})/.exec(response)[1]) })
    })
    socket.on('error', reject)
  })
}

function deny (_req, res) {
  res.statusCode = 401
  res.end('auth required')
}

for (const [name, options, targets] of [
  [
    'deprecated top-level ignoreDuplicateSlashes with a routerOptions object',
    { ignoreDuplicateSlashes: true, routerOptions: { maxParamLength: 200 } },
    [['/admin/secret', 401], ['//admin/secret', 401], ['/admin//secret', 401]]
  ],
  [
    'deprecated top-level useSemicolonDelimiter with a routerOptions object',
    { useSemicolonDelimiter: true, routerOptions: {} },
    [['/admin', 401], ['/admin;x', 401], ['/admin/secret;x', 401]]
  ],
  [
    'ignoreDuplicateSlashes in routerOptions',
    { routerOptions: { ignoreDuplicateSlashes: true } },
    [['//admin/secret', 401]]
  ],
  [
    'deprecated top-level ignoreDuplicateSlashes',
    { ignoreDuplicateSlashes: true },
    [['//admin/secret', 401]]
  ],
  [
    'routerOptions turning off a deprecated top-level option',
    { ignoreDuplicateSlashes: true, routerOptions: { ignoreDuplicateSlashes: false } },
    // The router does not collapse the slashes, so no route matches, and the
    // middleware still runs for the not found handler.
    [['/admin/secret', 401], ['//admin/secret', 401]]
  ]
]) {
  test(`${name} does not bypass path-scoped middleware`, async t => {
    const instance = Fastify(options)
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    instance.use('/admin', deny)
    instance.get('/admin', async () => ({ secret: true }))
    instance.get('/admin/secret', async () => ({ secret: true }))

    const address = await instance.listen({ port: 0, host: '127.0.0.1' })
    for (const [target, statusCode] of targets) {
      const response = await requestTarget(address, target)
      t.assert.strictEqual(response.statusCode, statusCode, target)
    }
  })
}

// initialConfig.routerOptions holds `false` both for a routerOptions value set
// to false, which the router uses, and for one left unset, where the router
// uses the deprecated top-level option, so the plugin cannot tell which one
// the router follows.
for (const [name, options, targets] of [
  [
    'useSemicolonDelimiter',
    { useSemicolonDelimiter: true, routerOptions: { useSemicolonDelimiter: false } },
    [
      ['/t/admin', 401], ['/t;x/admin', 400], ['/t/admin;x', 401],
      ['/teams/a;x/admin', 400], ['/files/a;b', 200]
    ]
  ],
  [
    'ignoreDuplicateSlashes',
    { ignoreDuplicateSlashes: true, routerOptions: { ignoreDuplicateSlashes: false } },
    [['/t/admin', 401], ['//admin', 400], ['/teams//admin', 400], ['/files/a', 200]]
  ],
  [
    'useSemicolonDelimiter with case-insensitive routing',
    { useSemicolonDelimiter: true, routerOptions: { useSemicolonDelimiter: false, caseSensitive: false } },
    [['/T/ADMIN', 401], ['/T;x/ADMIN', 400], ['/Files/a;b', 200]]
  ]
]) {
  test(`a routerOptions ${name} turned off next to the deprecated top-level option does not bypass middleware`, async t => {
    const instance = Fastify(options)
    t.after(() => instance.close())
    await instance.register(expressPlugin)

    instance.use('/:tenant/admin', deny)
    const router = express.Router()
    router.use('/teams/:team/admin', deny)
    instance.use(router)

    instance.get('/:tenant/admin', async () => ({ secret: true }))
    instance.get('/teams/:team/admin', async () => ({ secret: true }))
    instance.get('/files/:name', async () => ({ ok: true }))

    const address = await instance.listen({ port: 0, host: '127.0.0.1' })
    for (const [target, statusCode] of targets) {
      const response = await requestTarget(address, target)
      t.assert.strictEqual(response.statusCode, statusCode, target)
    }
  })
}
