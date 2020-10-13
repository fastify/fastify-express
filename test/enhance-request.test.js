'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const sget = require('simple-get').concat

const expressPlugin = require('../index')

test('Should enhance the Node.js core request/response objects', t => {
  t.plan(10)
  const fastify = Fastify()
  t.teardown(fastify.close)

  fastify.register(expressPlugin)

  fastify.get('/', async (req, reply) => {
    t.strictEqual(req.raw.originalUrl, req.raw.url)
    t.strictEqual(req.raw.id, req.id)
    t.strictEqual(req.raw.hostname, req.hostname)
    t.strictEqual(req.raw.protocol, req.protocol)
    t.strictEqual(req.raw.ip, req.ip)
    t.deepEqual(req.raw.ips, req.ips)
    t.ok(req.raw.log)
    t.ok(reply.raw.log)
    return { hello: 'world' }
  })

  fastify.listen(0, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      url: address
    }, (err, res, data) => {
      t.error(err)
    })
  })
})

test('trust proxy protocol', (t) => {
  t.plan(5)
  const fastify = Fastify({ trustProxy: true })

  t.tearDown(fastify.close.bind(fastify))

  fastify.register(expressPlugin).after(() => {
    fastify.use('/', function (req, res) {
      res.json({ ip: req.ip, hostname: req.hostname, protocol: req.protocol })
    })
  })

  fastify.listen(0, (err) => {
    t.error(err)
    sget({
      method: 'GET',
      headers: {
        'X-Forwarded-For': '1.1.1.1',
        'X-Forwarded-Host': 'example.com',
        'X-Forwarded-Proto': 'lorem'
      },
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, res, data) => {
      t.error(err)

      const parsed = JSON.parse(data)

      t.strictEqual(parsed.ip, '1.1.1.1', 'gets ip from x-forwarded-for')
      t.strictEqual(parsed.hostname, 'example.com', 'gets hostname from x-forwarded-host')
      t.strictEqual(parsed.protocol, 'lorem', 'gets protocol from x-forwarded-proto')
    })
  })
})
