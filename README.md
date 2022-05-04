# @fastify/express

![CI](https://github.com/fastify/fastify-express/workflows/CI/badge.svg)
[![NPM version](https://img.shields.io/npm/v/@fastify/express.svg?style=flat)](https://www.npmjs.com/package/@fastify/express)
[![Known Vulnerabilities](https://snyk.io/test/github/fastify/fastify-express/badge.svg)](https://snyk.io/test/github/fastify/fastify-express)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://standardjs.com/)

This plugin adds full [Express](http://expressjs.com) compatibility to Fastify, it exposes the same `use` function of Express, and it allows you to use any Express middleware or application.<br/>

<table>
  <tbody>
    <tr>
      <td rowspan="2"><b>Note</b></td>
      <td><b>This plugin should not be used as a long-term solution, it aims to help you have a smooth transition from Express to Fastify, but you should migrate your Express specific code to Fastify over time.</b></td>
    </tr>
    <tr>
      <td><b>Since <a href="https://github.com/expressjs/express/issues/2761">Express does not support Node.js core HTTP/2 module</a>, this plugin does not support HTTP/2 too.</b></td>
    </tr>
  <tbody>
</table>

## Install
```
npm i @fastify/express
```

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
  .then(fastify => fastify.listen(3000))
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

fastify.listen(3000, console.log)
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

### Hooks and middlewares

Every registered middleware will be run during the `onRequest` hook phase, so the registration order is important.  
Take a look at the [Lifecycle](https://www.fastify.io/docs/latest/Lifecycle/) documentation page to understand better how every request is executed.

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

If you need to run a middleware only under certain path(s), just pass the path as first parameter to use and you are done!

```js
const fastify = require('fastify')()
const path = require('path')
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

## TypeScript support

To use this module with TypeScript, make sure to install `@types/express`.

You will need to add `"types": ["@fastify/express"]` to your tsconfig.json file when using `require` to import the plugin.

## Middlewares alternatives

Fastify offers some alternatives to the most commonly used middlewares, following, you can find a list.

| Express Middleware | Fastify Plugin |
| ------------- |---------------|
| [`helmet`](https://github.com/helmetjs/helmet) | [`@fastify/helmet`](https://github.com/fastify/fastify-helmet) |
| [`cors`](https://github.com/expressjs/cors) | [`@fastify/cors`](https://github.com/fastify/fastify-cors) |
| [`serve-static`](https://github.com/expressjs/serve-static) | [`@fastify/static`](https://github.com/fastify/fastify-static) |

## Troubleshooting

### POST request with body hangs up

[body-parser](https://github.com/expressjs/body-parser) library incompatible with `fastify-express`, when you have `fastify` routes and any `express` middlewares.
Any POST requests with **body**, which `body-parser` will try to parse, will be hangs up.

Example application:

```js
const Fastify = require('fastify')
const Express = require('express')
const expressPlugin = require('fastify-express')
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

For this case, you need to remove `body-parser`, install `fastify-formbody` and change `fastify-express` options:


```js
const Fastify = require('fastify')
const Express = require('express')
const expressPlugin = require('fastify-express')
const fastifyFormBody = require('fastify-formbody')

const fastify = Fastify()
const express = Express()

await fastify.register(fastifyFormBody)
await fastify.register(expressPlugin, {
  // run express after `fastify-formbody` logic
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
