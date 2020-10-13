import Fastify from 'fastify'
import fastifyExpress from '../..'

const app = Fastify()

app.register(fastifyExpress)

app.express.disable('x-powered-by')

app.use('/world', (_req, res) => {
  res.sendStatus(200)
})
