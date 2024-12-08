import { Application, Request } from 'express'
import { FastifyPluginCallback, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Express middleware function
     */
    use: Application['use']

    /**
     * Express application instance
     */
    express: Application
  }
}

type FastifyExpress = FastifyPluginCallback<fastifyExpress.FastifyExpressOptions>

declare namespace fastifyExpress {

  export interface FastifyExpressOptions {
    expressHook?: string;
    createProxyHandler?: (fastifyReq: FastifyRequest) => ProxyHandler<Request>
  }

  export const fastifyExpress: FastifyExpress
  export { fastifyExpress as default }
}

declare function fastifyExpress (...params: Parameters<FastifyExpress>): ReturnType<FastifyExpress>
export = fastifyExpress
