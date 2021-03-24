# fastify-express

![CI](https://github.com/fastify/fastify-express/workflows/CI/badge.svg)
[![NPM version](https://img.shields.io/npm/v/fastify-express.svg?style=flat)](https://www.npmjs.com/package/fastify-express)
[![Known Vulnerabilities](https://snyk.io/test/github/fastify/fastify-express/badge.svg)](https://snyk.io/test/github/fastify/fastify-express)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://standardjs.com/)

This plugin adds full [Express](http://expressjs.com) compatibility to Fastify, it exposes the same `use` function of Express, and it allows you to use any Express middleware or application.<br/>

| **Note**   |  This plugin should not be used as a long-term solution, it aims to help you have a smooth transition from Express to Fastify, but you should migrate your Express specific code to Fastify over time.  |
| ----   |  :----  |

## Install
```
npm i fastify-express
```

## Usage
Register the plugin and start using your Express middlewares.
```js
const Fastify = require('fastify')

async function build () {
  const fastify = Fastify()
  await fastify.register(require('fastify-express'))
  // do you know we also have cors support?
  // https://github.com/fastify/fastify-cors
  fastify.use(require('cors')())
  // express.Application is also accessible
  fastify.express.disabled('x-powered-by') // true
  return fastify
}

build()
  .then(fastify => fastify.listen(3000))
  .catch(console.log)
```

### Add a complete application

You can register an entire Express application and make it work with Fastify.

```js
const fastify = require('fastify')()
const router = require('express').Router()

router.use(function (req, res, next) {
  res.setHeader('x-custom', true)
  next()
})

router.get('/hello', (req, res) => {
  res.status(201)
  res.json({ hello: 'world' })
})

router.get('/foo', (req, res) => {
  res.status(400)
  res.json({ foo: 'bar' })
})

fastify.register(require('fastify-express'))
  .after(() => {fastify.use(router)})

fastify.listen(3000, console.log)
```

### Encapsulation support

The encapsulation works as usual with Fastify, you can register the plugin in a subsystem and your express code will work only inside there, or you can declare the express plugin top level and register a middleware in a nested plugin, and the middleware will be executed only for the nested routes of the specific plugin.

*Register the plugin in its own subsystem:*
```js
const fastify = require('fastify')()

fastify.register(subsystem)

async function subsystem (fastify, opts) {
  await fastify.register(require('fastify-express'))
  fastify.use(require('cors')())
}
```

*Register a middleware in a specific plugin:*
```js
const fastify = require('fastify')()

fastify
  .register(require('fastify-express'))
  .register(subsystem)

async function subsystem (fastify, opts) {
  fastify.use(require('cors')())
}
```

### Hooks and middlewares

Every registered middleware will be run during the `onRequest` hook phase, so the registration order is important.  
Take a look at the [Lifecycle](https://www.fastify.io/docs/latest/Lifecycle/) documentation page to understand better how every request is executed.

```js
const fastify = require('fastify')()

fastify
  .register(require('fastify-express'))
  .register(subsystem)

async function subsystem (fastify, opts) {
  fastify.addHook('onRequest', async (req, reply) => {
    console.log('first')
  })

  fastify.use((req, res, next) => {
    console.log('second')
    next()
  })

  fastify.addHook('onRequest', async (req, reply) => {
    console.log('third')
  })
}
```

### Restrict middleware execution to a certain path(s)

If you need to run a middleware only under certain path(s), just pass the path as first parameter to use and you are done!

```js
const fastify = require('fastify')()
const path = require('path')
const serveStatic = require('serve-static')

fastify
  .register(require('fastify-express'))
  .register(subsystem)

async function subsystem (fastify, opts) {
  // Single path
  fastify.use('/css', serveStatic(path.join(__dirname, '/assets')))

  // Wildcard path
  fastify.use('/css/*', serveStatic(path.join(__dirname, '/assets')))

  // Multiple paths
  fastify.use(['/css', '/js'], serveStatic(path.join(__dirname, '/assets')))
}
```

## TypeScript support

To use this module with TypeScript, make sure to install `@types/express`.

## Middlewares alternatives

Fastify offers some alternatives to the most commonly used middlewares, following, you can find a list.

| Express Middleware | Fastify Plugin |
| ------------- |---------------|
| [`helmet`](https://github.com/helmetjs/helmet) | [`fastify-helmet`](https://github.com/fastify/fastify-helmet) |
| [`cors`](https://github.com/expressjs/cors) | [`fastify-cors`](https://github.com/fastify/fastify-cors) |
| [`serve-static`](https://github.com/expressjs/serve-static) | [`fastify-static`](https://github.com/fastify/fastify-static) |

## License

Licensed under [MIT](./LICENSE).<br/>
[`express` license](https://github.com/expressjs/express/blob/master/LICENSE)
