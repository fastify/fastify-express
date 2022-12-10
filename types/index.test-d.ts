import Fastify, {FastifyRequest} from 'fastify'
import fastifyExpress from '..'
import { expectType } from "tsd"
import { Application } from 'express'

const app = Fastify()

app.decorateRequest('testTsd', '')
app.register(fastifyExpress)
app.register(fastifyExpress, {
  expressHook: 'onRequest',
  createProxyHandler: (fastifyReq) => ({
    set(target, prop, value) {
      expectType<FastifyRequest>(fastifyReq)
      return Reflect.set(target, prop, value)
    }
  })
})

expectType<Application>(app.express)

app.express.disable('x-powered-by')

app.use('/world', (req, res) => {
  res.sendStatus(200)
})