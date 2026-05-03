import Fastify, { FastifyRequest } from 'fastify'
import fastifyExpress from '..'
import { expect } from 'tstyche'
import { Application } from 'express'

const app = Fastify()

app.register(fastifyExpress)
app.register(fastifyExpress, {
  expressHook: 'onRequest',
  createProxyHandler: (fastifyReq) => ({
    set (target, prop, value) {
      expect(fastifyReq).type.toBe<FastifyRequest>()
      return Reflect.set(target, prop, value)
    }
  })
})

expect(app.express).type.toBe<Application>()

app.express.disable('x-powered-by')

app.use('/world', (_req, res) => {
  res.sendStatus(200)
})
