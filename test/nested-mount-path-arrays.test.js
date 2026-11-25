'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')

const expressPlugin = require('../index')

function deny (_req, res) {
  res.statusCode = 401
  res.end('auth required')
}

async function check (t, instance, expected) {
  const address = await instance.listen({ port: 0, host: '127.0.0.1' })
  for (const [path, status] of expected) {
    const response = await fetch(address + path)
    t.assert.strictEqual(response.status, status, path)
  }
}

test('nested arrays of mount paths are prefixed in prefixed plugins', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const ADMIN_PATHS = ['/admin', ['/settings']]
  instance.register(async function (scoped) {
    scoped.use([ADMIN_PATHS, '/billing'], deny)
    scoped.get('/admin/users', async () => ({ secret: true }))
    scoped.get('/settings/keys', async () => ({ secret: true }))
    scoped.get('/billing/invoices', async () => ({ secret: true }))
  }, { prefix: '/api' })

  await check(t, instance, [
    ['/api/admin/users', 401],
    ['/api/settings/keys', 401],
    ['/api/billing/invoices', 401]
  ])
})

test('a nested RegExp mount path loses its g and y flags', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use([[/^\/root/g, [/^\/sticky/y]]], deny)
  instance.get('/root/x', async () => ({ secret: true }))
  instance.get('/sticky/x', async () => ({ secret: true }))

  await check(t, instance, [
    ['/root/x', 401],
    ['/root/x', 401],
    ['/root/x', 401],
    ['/sticky/x', 401],
    ['/sticky/x', 401]
  ])
})

test('nested mount paths are folded and checked for empty segments', async t => {
  const instance = Fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  instance.use([[/^\/Admin/, ['/users/:id']]], deny)
  instance.get('/admin/x', async () => ({ secret: true }))
  instance.get('/users/:id', async () => ({ secret: true }))

  await check(t, instance, [
    ['/ADMIN/x', 401],
    ['/users/1', 401],
    ['/users/', 400]
  ])
})
