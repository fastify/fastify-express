import Fastify from 'fastify'
import fastifyExpress from '../..'

const app = Fastify()

app.register(fastifyExpress)

app.express.disable('x-powered-by')
