// Core dependencies
const path = require('path')

// NPM dependencies
const bodyParser = require('body-parser')
const dotenv = require('dotenv')
const express = require('express')
const nunjucks = require('nunjucks')
const sessionInCookie = require('client-sessions')
const sessionInMemory = require('express-session')
const cookieParser = require('cookie-parser')

// Run before other code to make sure variables from .env are available
dotenv.config()

// Local dependencies
const middleware = [
  require('./lib/middleware/authentication/authentication.js'),
  require('./lib/middleware/extensions/extensions.js')
]
const config = require('./app/config.js')
const packageJson = require('./package.json')
const routes = require('./app/routes.js')
const utils = require('./lib/utils.js')
const extensions = require('./lib/extensions/extensions.js')

// Variables for v6 backwards compatibility
// Set false by default, then turn on if we find /app/v6/routes.js
var useV6 = false
var v6App
var v6Routes

try {
  v6Routes = require('./app/v6/routes.js')
  useV6 = true
} catch (e) {
  // No routes.js in app/v6 so we can continue with useV6 false
}

const app = express()

if (useV6) {
  console.log('/app/v6/routes.js detected - using v6 compatibility mode')
  v6App = express()
}

// Set cookies for use in cookie banner.
app.use(cookieParser())
const handleCookies = utils.handleCookies(app)
app.use(handleCookies)

// Set up configuration variables
var releaseVersion = packageJson.version
var env = (process.env.NODE_ENV || 'development').toLowerCase()
var useAutoStoreData = process.env.USE_AUTO_STORE_DATA || config.useAutoStoreData
var useCookieSessionStore = process.env.USE_COOKIE_SESSION_STORE || config.useCookieSessionStore
var useHttps = process.env.USE_HTTPS || config.useHttps

useHttps = useHttps.toLowerCase()

// Force HTTPS on production. Do this before using basicAuth to avoid
// asking for username/password twice (for `http`, then `https`).
var isSecure = (env === 'production' && useHttps === 'true')
if (isSecure) {
  app.use(utils.forceHttps)
  app.set('trust proxy', 1) // needed for secure cookies on heroku
}

middleware.forEach(func => app.use(func))

// Set up App
var appViews = extensions.getAppViews([
  path.join(__dirname, '/app/views/'),
  path.join(__dirname, '/lib/')
])

var nunjucksConfig = {
  autoescape: true,
  noCache: true,
  watch: false // We are now setting this to `false` (it's by default false anyway) as having it set to `true` for production was making the tests hang
}

if (env === 'development') {
  nunjucksConfig.watch = true
}

nunjucksConfig.express = app

var nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

// Add Nunjucks filters
utils.addNunjucksFilters(nunjucksAppEnv)

// Set views engine
app.set('view engine', 'html')

// Middleware to serve static assets
app.use('/public', express.static(path.join(__dirname, '/public')))

// Serve govuk-frontend in from node_modules (so not to break pre-extenstions prototype kits)
app.use('/node_modules/govuk-frontend', express.static(path.join(__dirname, '/node_modules/govuk-frontend')))

// Support for parsing data in POSTs
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
  extended: true
}))

// Set up v6 app for backwards compatibility
if (useV6) {
  var v6Views = [
    path.join(__dirname, '/node_modules/govuk_template_jinja/views/layouts'),
    path.join(__dirname, '/app/v6/views/'),
    path.join(__dirname, '/lib/v6') // for old unbranded template
  ]
  nunjucksConfig.express = v6App
  var nunjucksV6Env = nunjucks.configure(v6Views, nunjucksConfig)

  // Nunjucks filters
  utils.addNunjucksFilters(nunjucksV6Env)

  // Set views engine
  v6App.set('view engine', 'html')

  // Backward compatibility with GOV.UK Elements
  app.use('/public/v6/', express.static(path.join(__dirname, '/node_modules/govuk_template_jinja/assets')))
  app.use('/public/v6/', express.static(path.join(__dirname, '/node_modules/govuk_frontend_toolkit')))
  app.use('/public/v6/javascripts/govuk/', express.static(path.join(__dirname, '/node_modules/govuk_frontend_toolkit/javascripts/govuk/')))
}

// Add variables that are available in all views
app.locals.asset_path = '/public/'
app.locals.useAutoStoreData = (useAutoStoreData === 'true')
app.locals.useCookieSessionStore = (useCookieSessionStore === 'true')
app.locals.cookieText = config.cookieText
app.locals.releaseVersion = 'v' + releaseVersion
app.locals.serviceName = config.serviceName
// extensionConfig sets up variables used to add the scripts and stylesheets to each page.
app.locals.extensionConfig = extensions.getAppConfig()

// Session uses service name to avoid clashes with other prototypes
const sessionName = 'govuk-prototype-kit-' + (Buffer.from(config.serviceName, 'utf8')).toString('hex')
let sessionOptions = {
  secret: sessionName,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4, // 4 hours
    secure: isSecure
  }
}

// Support session data in cookie or memory
if (useCookieSessionStore === 'true') {
  app.use(sessionInCookie(Object.assign(sessionOptions, {
    cookieName: sessionName,
    proxy: true,
    requestKey: 'session'
  })))
} else {
  app.use(sessionInMemory(Object.assign(sessionOptions, {
    name: sessionName,
    resave: false,
    saveUninitialized: false
  })))
}

// Automatically store all data users enter
if (useAutoStoreData === 'true') {
  app.use(utils.autoStoreData)
  utils.addCheckedFunction(nunjucksAppEnv)
  if (useV6) {
    utils.addCheckedFunction(nunjucksV6Env)
  }
}

// Prevent search indexing (set headers before app routes so they can be overridden)
app.use(function (req, res, next) {
  // Setting headers stops pages being indexed even if indexed pages link to them.
  res.setHeader('X-Robots-Tag', 'noindex')
  next()
})

// Clear all data in session if you open /prototype-admin/clear-data
app.post('/prototype-admin/clear-data', function (req, res) {
  req.session.data = {}
  res.render('prototype-admin/clear-data-success')
})

// Load routes (found in app/routes.js)
if (typeof (routes) !== 'function') {
  console.log(routes.bind)
  console.log('Warning: the use of bind in routes is deprecated - please check the Prototype Kit documentation for writing routes.')
  routes.bind(app)
} else {
  app.use('/', routes)
}

if (useV6) {
  // Clone app locals to v6 app locals
  v6App.locals = Object.assign({}, app.locals)
  v6App.locals.asset_path = '/public/v6/'

  // Create separate router for v6
  app.use('/', v6App)

  // Docs under the /docs namespace
  v6App.use('/', v6Routes)
}

// Strip .html and .htm if provided
app.get(/\.html?$/i, function (req, res) {
  var path = req.path
  var parts = path.split('.')
  parts.pop()
  path = parts.join('.')
  res.redirect(path)
})

// Auto render any view that exists

// App folder routes get priority
app.get(/^([^.]+)$/, function (req, res, next) {
  utils.matchRoutes(req, res, next)
})

if (useV6) {
  // App folder routes get priority
  v6App.get(/^([^.]+)$/, function (req, res, next) {
    utils.matchRoutes(req, res, next)
  })
}

// Prevent search indexing (set robots after app routes so it can be overridden)

app.get('/robots.txt', function (req, res) {
  res.type('text/plain')
  res.send('User-agent: *\nDisallow: /')
})

// Redirect all POSTs to GETs - this allows users to use POST for autoStoreData
app.post(/^\/([^.]+)$/, function (req, res) {
  res.redirect('/' + req.params[0])
})

// Catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error(`Page not found: ${req.path}`)
  err.status = 404
  next(err)
})

// Display error
app.use(function (err, req, res, next) {
  console.error(err.message)
  res.status(err.status || 500)
  res.send(err.message)
})

console.log('\nGOV.UK Prototype Kit v' + releaseVersion)
console.log('\nNOTICE: the kit is for building prototypes, do not use it for production services.')

module.exports = app
