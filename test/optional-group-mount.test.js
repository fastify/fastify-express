'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')

const expressPlugin = require('../index')

function deny (_req, res) {
  res.statusCode = 401
  res.end('auth required')
}

test('mount paths starting with an optional group match as in Express', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use('{/:lang}/admin', deny)
  instance.get('/admin/users', async () => ({ secret: true }))
  instance.get('/:lang/admin/users', async () => ({ secret: true }))

  for (const prefix of ['/api', '/v1/']) {
    instance.register(async function (scoped) {
      scoped.use('{/:lang}/admin', deny)
      scoped.get('/admin/users', async () => ({ secret: true }))
      scoped.get('/:lang/admin/users', async () => ({ secret: true }))
      scoped.get('/public', async () => 'public')
    }, { prefix })
  }

  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  for (const [path, status] of [
    ['/admin/users', 401],
    ['/en/admin/users', 401],
    ['/api/admin/users', 401],
    ['/api/en/admin/users', 401],
    ['/v1/admin/users', 401],
    ['/v1/en/admin/users', 401],
    ['/api/public', 200]
  ]) {
    const response = await fetch(address + path)
    t.assert.strictEqual(response.status, status, path)
  }
})
