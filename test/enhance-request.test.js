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
    t.equal(req.raw.originalUrl, req.raw.url)
    t.equal(req.raw.id, req.id)
    t.equal(req.raw.hostname, req.hostname)
    t.equal(req.raw.protocol, req.protocol)
    t.equal(req.raw.ip, req.ip)
    t.same(req.raw.ips, req.ips)
    t.ok(req.raw.log)
    t.ok(reply.raw.log)
    return { hello: 'world' }
  })

  fastify.listen({ port: 0 }, (err, address) => {
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

  t.teardown(fastify.close.bind(fastify))

  fastify.register(expressPlugin).after(() => {
    fastify.use('/', function (req, res) {
      t.equal(req.ip, '1.1.1.1', 'gets ip from x-forwarded-for')
      t.equal(req.hostname, 'example.com', 'gets hostname from x-forwarded-host')
      t.equal(req.protocol, 'lorem', 'gets protocol from x-forwarded-proto')

      res.sendStatus(200)
    })
  })

  fastify.listen({ port: 0 }, (err, address) => {
    t.error(err)
    sget({
      method: 'GET',
      headers: {
        'X-Forwarded-For': '1.1.1.1',
        'X-Forwarded-Host': 'example.com',
        'X-Forwarded-Proto': 'lorem'
      },
      url: address
    }, (err, res, data) => {
      t.error(err)
    })
  })
})
