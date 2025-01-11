# @fastify/express

[![CI](https://github.com/fastify/fastify-express/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/fastify/fastify-express/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/@fastify/express.svg?style=flat)](https://www.npmjs.com/package/@fastify/express)
[![neostandard javascript style](https://img.shields.io/badge/code_style-neostandard-brightgreen?style=flat)](https://github.com/neostandard/neostandard)

This plugin adds full [Express](http://expressjs.com) compatibility to Fastify, it exposes the same `use` function of Express, and it allows you to use any Express middleware or application.<br/>

<table>
  <tbody>
    <tr>
      <td rowspan="2"><b>Note</b></td>
      <td><b>This plugin should not be used as a long-term solution, it aims to help you have a smooth transition from Express to Fastify, but you should migrate your Express specific code to Fastify over time.</b></td>
    </tr>
    <tr>
      <td><b>Since <a href="https://github.com/expressjs/express/issues/2761">Express does not support Node.js core HTTP/2 module</a>, this plugin does not support HTTP/2 either.</b></td>
    </tr>
  <tbody>
</table>

## Install
```
npm i @fastify/express
```

### Compatibility
| Plugin version | Fastify version |
| ---------------|-----------------|
| `^4.x`         | `^5.x`          |
| `^2.x`         | `^4.x`          |
| `^1.x`         | `^3.x`          |
| `^0.x`         | `^2.x`          |


Please note that if a Fastify version is out of support, then so are the corresponding versions of this plugin
in the table above.
See [Fastify's LTS policy](https://github.com/fastify/fastify/blob/main/docs/Reference/LTS.md) for more details.

## Usage
Register the plugin and start using your Express middlewares.
```js
const Fastify = require('fastify')

async function build () {
  const fastify = Fastify()
  await fastify.register(require('@fastify/express'))
  // do you know we also have cors support?
  // https://github.com/fastify/fastify-cors
  fastify.use(require('cors')())
  // express.Application is also accessible
  fastify.express.disabled('x-powered-by') // true
  return fastify
}

build()
  .then(fastify => fastify.listen({ port: 3000 }))
  .catch(console.log)
```

### Add a complete application

You can register an entire Express application and make it work with Fastify. Remember, `@fastify/express` is just `express` under the covers and requires the same body parsers as you'd use in `express`.

```js
// index.js
const fastify = require('fastify')()
const express = require('express')
const router = express.Router()

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

router.patch('/bar', (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    res.status(400)
    res.json({ msg: 'no req.body'})
  } else {
    res.status(200)
    res.json(req.body)
  }
})

router.use('*', (req, res) => {
  res.status(404)
  res.json({ msg: 'not found'})
})

fastify.register(require('@fastify/express'))
  .after(() => {
    fastify.use(express.urlencoded({extended: false})) // for Postman x-www-form-urlencoded
    fastify.use(express.json())

    fastify.use(router)
  })

fastify.listen({ port: 3000 }, console.log)
```

#### Testing Your App
Run `node index.js` to start your server. Then run the following commands to ensure your server is working. Use the optional `-v` flag in curl for verbose output.

```bash
me@computer ~ % curl -X GET http://localhost:3000/hello
{"hello":"world"}%
me@computer ~ % curl -X GET http://localhost:3000/foo
{"foo":"bar"}%
me@computer ~ % curl -X GET http://localhost:3000/bar
{"msg":"not found"}%
me@computer ~ % curl -X PATCH -H 'content-type:application/json' http://localhost:3000/bar
{"msg":"no req.body"}%
me@computer ~ % curl -X PATCH -H 'content-type:application/json' -d '{"foo2":"bar2"}' http://localhost:3000/bar
{"foo2":"bar2"}%
```

### Encapsulation support

The encapsulation works as usual with Fastify, you can register the plugin in a subsystem and your express code will work only inside there, or you can declare the express plugin top level and register a middleware in a nested plugin, and the middleware will be executed only for the nested routes of the specific plugin.

*Register the plugin in its own subsystem:*
```js
const fastify = require('fastify')()

fastify.register(subsystem)

async function subsystem (fastify, opts) {
  await fastify.register(require('@fastify/express'))
  fastify.use(require('cors')())
}
```

*Register a middleware in a specific plugin:*
```js
const fastify = require('fastify')()

fastify
  .register(require('@fastify/express'))
  .register(subsystem)

async function subsystem (fastify, opts) {
  fastify.use(require('cors')())
}
```

### Hooks and middleware

Every registered middleware will be run during the `onRequest` hook phase, so the registration order is important.
Take a look at the [Lifecycle](https://fastify.dev/docs/latest/Reference/Lifecycle) documentation page to understand better how every request is executed.

```js
const fastify = require('fastify')()

fastify
  .register(require('@fastify/express'))
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

If you need to run a middleware only under certain path(s), just pass the path as the first parameter to use and you are done!

```js
const fastify = require('fastify')()
const path = require('node:path')
const serveStatic = require('serve-static')

fastify
  .register(require('@fastify/express'))
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

### Wrap Express req in Proxy

It is possible to wrap the Express request object in a Proxy by passing `createProxyHandler` function to generate the Proxy handler. The function will receive the Fastify request object as the first parameter.

For example, using Proxy to expose something from Fastify request into the Express request.

```js
fastify.decorateRequest('welcomeMessage', 'Hello World');
fastify.register(expressPlugin, {
  createProxyHandler: fastifyRequest => ({
    get (target, prop) {
      if (prop === 'welcomeMessage') {
        return fastifyRequest[prop]
      }

      return target[prop]
    }
  })
})
```

## TypeScript support

To use this module with TypeScript, make sure to install `@types/express`.

You will need to add `"types": ["@fastify/express"]` to your tsconfig.json file when using `require` to import the plugin.

## Middleware alternatives

Fastify offers some alternatives to the most commonly used middleware:

| Express Middleware | Fastify Plugin |
| ------------- |---------------|
| [`helmet`](https://github.com/helmetjs/helmet) | [`@fastify/helmet`](https://github.com/fastify/fastify-helmet) |
| [`cors`](https://github.com/expressjs/cors) | [`@fastify/cors`](https://github.com/fastify/fastify-cors) |
| [`serve-static`](https://github.com/expressjs/serve-static) | [`@fastify/static`](https://github.com/fastify/fastify-static) |

## Troubleshooting

### POST request with body hangs up

[body-parser](https://github.com/expressjs/body-parser) library incompatible with `fastify-express`, when you have `fastify` routes and any `express` middlewares.
Any POST requests with **body**, which `body-parser` will try to parse, will hang up.

Example application:

```js
const Fastify = require('fastify')
const Express = require('express')
const expressPlugin = require('@fastify/express')
const bodyParser = require('body-parser')

const fastify = Fastify()
const express = Express()

express.use(bodyParser.urlencoded({ extended: false }))

await fastify.register(expressPlugin)

fastify.use(express)

// this route will never reply
fastify.post('/hello', (req, reply) => {
  return { hello: 'world' }
})
```

For this case, you need to remove `body-parser`, install `@fastify/formbody` and change `@fastify/express` options:


```js
const Fastify = require('fastify')
const Express = require('express')
const expressPlugin = require('@fastify/express')
const fastifyFormBody = require('@fastify/formbody')

const fastify = Fastify()
const express = Express()

await fastify.register(fastifyFormBody)
await fastify.register(expressPlugin, {
  // run express after `@fastify/formbody` logic
  expressHook: 'preHandler'
})

fastify.use(express)

// it works!
fastify.post('/hello', (req, reply) => {
  return { hello: 'world' }
})
```

## License

Licensed under [MIT](./LICENSE).<br/>
[`express` license](https://github.com/expressjs/express/blob/master/LICENSE)
