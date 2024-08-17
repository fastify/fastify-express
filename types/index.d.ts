import { Application, Request } from "express";
import { FastifyPluginCallback, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Express middleware function
     */
    use: Application["use"];

    /**
     * @private
     * Express application instance
     */
    express: Application;
  }

  interface FastifyContextConfig {
    /**
     * @private
     * Will run express middleware registered fo
     * WARN: makes route incompatible with networkless http reqeusts
     * do not set in a pushpress application! use lifecycle hooks instead
     */
    useExpressMiddleware?: boolean;
  }
}

type FastifyExpress =
  FastifyPluginCallback<fastifyExpress.FastifyExpressOptions>;

declare namespace fastifyExpress {
  export interface FastifyExpressOptions {
    expressHook?: string;
    createProxyHandler?: (fastifyReq: FastifyRequest) => ProxyHandler<Request>;
  }

  export const fastifyExpress: FastifyExpress;
  export { fastifyExpress as default };
}

declare function fastifyExpress(
  ...params: Parameters<FastifyExpress>
): ReturnType<FastifyExpress>;
export = fastifyExpress;
