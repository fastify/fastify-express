'use strict'

const net = require('node:net')
const { test } = require('node:test')
const Fastify = require('fastify')
const express = require('express')
const express4 = require('express4')

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
  for (const [target, statusCode] of expected) {
    const response = await requestTarget(address, target)
    t.assert.strictEqual(response.statusCode, statusCode, target)
  }
}

test('empty values do not bypass dynamic mounts inside an Express Router', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const router = express.Router()
  router.use('/tenants/:tenant/admin', deny)
  router.all('/files/*path', deny)
  router.use('/reports/:year-:month', deny)
  router.use('/images/:name.:ext', deny)
  router.use(/^\/orders\/\d+\/items/, deny)
  instance.use(router)

  instance.get('/tenants/:tenant/admin', async () => ({ secret: true }))
  instance.get('/files/*', async () => ({ secret: true }))
  instance.get('/reports/:year-:month', async () => ({ secret: true }))
  instance.get('/images/:name.:ext', async () => ({ secret: true }))
  instance.get('/orders/:id/items', async () => ({ secret: true }))

  await check(t, instance, [
    ['/tenants/acme/admin', 401],
    ['/tenants//admin', 400],
    ['/files/a.txt', 401],
    ['/files/', 400],
    ['/reports/2026-11', 401],
    ['/reports/2026-', 400],
    ['/images/logo.png', 401],
    ['/images/.png', 400],
    ['/orders/42/items', 401],
    ['/orders//items', 400]
  ])
})

test('empty values do not bypass dynamic mounts inside nested Routers and applications', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  // A Router inside a Router.
  const inner = express.Router()
  inner.use('/:tenant/admin', deny)
  const outer = express.Router()
  outer.use('/tenants', inner)
  // A wildcard route, with a parameter mount in a Router mounted below it.
  const downloads = express.Router()
  downloads.use('/:file', deny)
  outer.use('/downloads', downloads)
  instance.use(outer)

  // An application passed to use().
  const app = express()
  app.use('/teams/:team/admin', deny)
  instance.use(app)

  // An application inside a Router.
  const routerApp = express()
  routerApp.use('/:org/admin', deny)
  const appRouter = express.Router()
  appRouter.use('/orgs', routerApp)
  instance.use(appRouter)

  // An application mounted inside another one is wrapped by Express, so the
  // plugin cannot look into it and rejects any empty value that reaches it.
  const nestedApp = express()
  nestedApp.use('/:id/admin', deny)
  const parentApp = express()
  parentApp.use('/projects', nestedApp)
  instance.use(parentApp)

  for (const prefix of ['tenants', 'teams', 'orgs', 'projects']) {
    instance.get(`/${prefix}/:id/admin`, async () => ({ secret: true }))
  }
  instance.get('/downloads/*', async () => ({ secret: true }))

  await check(t, instance, [
    ['/tenants/acme/admin', 401],
    ['/tenants//admin', 400],
    ['/teams/core/admin', 401],
    ['/teams//admin', 400],
    ['/orgs/fastify/admin', 401],
    ['/orgs//admin', 400],
    ['/projects/1/admin', 401],
    ['/projects//admin', 400],
    ['/downloads/a.zip', 401],
    ['/downloads/', 400]
  ])
})

test('empty values do not bypass dynamic mounts inside a Router in a prefixed plugin', async t => {
  const instance = Fastify({ routerOptions: { caseSensitive: false } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  await instance.register(async function (scoped) {
    const router = express.Router()
    router.use('/users/:user/settings', deny)
    scoped.use('/', router)
    scoped.get('/users/:user/settings', async () => ({ secret: true }))
    scoped.get('/files/:name', async () => ({ ok: true }))
  }, { prefix: '/Tenant/:tenant' })

  await check(t, instance, [
    ['/tenant/acme/users/x/settings', 401],
    ['/TENANT/acme/users/x/settings', 401],
    ['/tenant/acme/users/x%2Fy/settings', 401],
    ['/tenant/acme/users/%20/settings', 401],
    ['/tenant/acme/users/;/settings', 401],
    ['/tenant/acme/users/%25/settings', 401],
    ['/tenant/acme/users//settings', 400],
    ['/tenant//users/x/settings', 400],
    ['/tenant/acme/files/a', 200],
    // The Router is mounted at the prefix, so an empty tenant skips all of it.
    ['/tenant//files/a', 400]
  ])
})

test('empty values reach routes that no nested dynamic mount covers', async t => {
  const instance = Fastify({ routerOptions: { useSemicolonDelimiter: true } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const router = express.Router()
  router.use((_req, _res, next) => next())
  router.all(/.*/, (_req, _res, next) => next())
  router.use('/admin', deny)
  router.get('/express/:id', (_req, res) => res.end('express'))
  // An error-handling middleware does not run for the request.
  router.use('/users/:id', (err, _req, _res, next) => next(err))
  instance.use(router)

  instance.get('/users/:id', async () => ({ ok: true }))
  instance.get('/static/*', async () => ({ ok: true }))
  instance.get('/o/:id?', async () => ({ ok: true }))
  instance.get('/r/:id(^\\d+)-::x', async () => ({ ok: true }))

  await check(t, instance, [
    ['/users/', 200],
    ['/users/1', 200],
    ['/static/', 200],
    ['/static/a/b', 200],
    ['/o/', 200],
    ['/o', 200],
    ['/r/1-:x', 200],
    ['/admin', 401],
    ['/express/1', 200]
  ])
})

test('routes are spelled like requests when looking for nested dynamic mounts', async t => {
  const instance = Fastify({ routerOptions: { ignoreDuplicateSlashes: true } })
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const router = express.Router()
  // A literal colon is `::` in a Fastify route and `\:` in an Express path.
  router.use('/r/:id/a\\:b/:name', deny)
  // Express runs a RegExp mount only when it matches a prefix of the path
  // that ends at a slash, so these never run.
  router.use(/admin/, deny)
  router.use(/^\/x/, deny)
  instance.use(router)

  instance.get('/r/:id(^(?:\\d+))/a::b/:name', async () => ({ secret: true }))
  instance.get('/z/admin/:id', async () => ({ ok: true }))
  instance.get('/xy/:id', async () => ({ ok: true }))

  await check(t, instance, [
    ['/r/1/a:b/c', 401],
    ['/r/1/a:b/', 400],
    ['/z/admin/1', 200],
    ['/z/admin/', 200],
    ['/xy/1', 200],
    ['/xy/', 200]
  ])
})

test('empty values do not bypass an unanchored RegExp mount that matches later in the path', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  // Express only runs a RegExp mount whose match starts the path, so the
  // match further along `/users//users/x` does not count.
  instance.use(/\/users\/[^/]+/, deny)
  instance.get('/users/:id/*', async () => ({ secret: true }))

  await check(t, instance, [
    ['/users/1/profile', 401],
    ['/users//profile', 400],
    ['/users//users/x', 400]
  ])
})

test('empty values reach routes when an application follows another middleware', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  const app = express()
  app.use('/teams/:team/admin', deny)
  instance.use((_req, _res, next) => next(), app)

  instance.get('/teams/:id/admin', async () => ({ secret: true }))
  instance.get('/users/:id', async () => ({ ok: true }))

  await check(t, instance, [
    ['/teams/core/admin', 401],
    ['/teams//admin', 400],
    ['/users/', 200]
  ])
})

test('empty values do not bypass dynamic mounts inside an Express 4 Router or application', async t => {
  const instance = Fastify()
  t.after(() => instance.close())
  await instance.register(expressPlugin)

  // An application can pass a Router or application from its own Express 4,
  // whose layers differ from those of Express 5.
  const router = express4.Router()
  router.use('*', (_req, _res, next) => next())
  router.use('/tenants/:tenant/admin', deny)
  // Express 4 also runs a mount whose match ends at a dot.
  router.use(/^\/images\/[^/.]+/, deny)
  // It still does not run one whose match ends elsewhere.
  router.use(/^\/x/, deny)
  router.get('/express/:id', (_req, res) => res.end('express'))
  instance.use(router)

  const app = express4()
  app.use('/teams/:team/admin', deny)
  instance.use(app)
  // An application that has no middleware or routes has no router yet.
  instance.use(express4())

  instance.get('/tenants/:id/admin', async () => ({ secret: true }))
  instance.get('/images/:name.png', async () => ({ secret: true }))
  instance.get('/teams/:id/admin', async () => ({ secret: true }))
  instance.get('/users/:id', async () => ({ ok: true }))
  instance.get('/xy/:id', async () => ({ ok: true }))

  await check(t, instance, [
    ['/tenants/acme/admin', 401],
    ['/tenants//admin', 400],
    ['/images/logo.png', 401],
    ['/images/.png', 400],
    ['/teams/core/admin', 401],
    ['/teams//admin', 400],
    ['/users/', 200],
    ['/xy/1', 200],
    ['/xy/', 200],
    ['/express/1', 200]
  ])
})
