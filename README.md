# fastify-express

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)

This plugin adds full [Express](http://expressjs.com) compatibility to Fastify, it exposes the same `use` function of Express, and it allows you to use any Express middleware.<br/>

**Note:** this plugin should not be used as a long-term solution, it aims to help you have a smooth transition from Express to Fastify, but you should migrate your Express specific code to Fastify during time.

## Install
```
npm i fastify-express
```

## Usage
Register the plugin and start using your Express middlewares!
```js
const fastify = require('fastify')()
fastify.register(require('fastify-express'))
  .after(() => {
     // do you know we also have cors support?
     // https://github.com/fastify/fastify-cors
    fastify.use(require('cors')())
  })

fastify.listen(3000)
```

## License

Licensed under [MIT](./LICENSE).<br/>
[`express` license](https://github.com/expressjs/express/blob/master/LICENSE)
