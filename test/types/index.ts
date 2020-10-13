import Fastify from 'fastify'
import fastifyExpress = require('../..')

const app = Fastify()

app.register(fastifyExpress)
