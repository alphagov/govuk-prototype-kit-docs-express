// Core dependencies
const fs = require('fs')
const path = require('path')

// NPM dependencies
const express = require('express')
const marked = require('marked')
const router = express.Router()

// Local dependencies
const utils = require('../lib/utils.js')

const gtmId = process.env.GOOGLE_TAG_MANAGER_TRACKING_ID

// Add global variable to determine if DoNotTrack is enabled.
// This indicates a user has explicitly opted-out of tracking.
// Therefore we can avoid injecting third-party scripts that do not respect this decision.
router.use(function (req, res, next) {
  res.locals.gtmId = gtmId
  // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/DNT
  res.locals.doNotTrackEnabled = (req.header('DNT') === '1')
  next()
})

// Page routes

router.use(function (req, res, next) {
  // Remove the noindex robots header set by the kit, to enable search engines to index the docs site
  res.removeHeader('X-Robots-Tag')
  next()
})

// Allow search engines to index the Prototype Kit documentation site
router.get('/robots.txt', function (req, res) {
  res.type('text/plain')
  res.send('User-agent: *\nAllow: /')
})

// redirect /docs/[path] to /[path] so old links don't break
router.get('/docs*', function (req, res) {
  // replace both /docs and /docs/
  const newPath = req.path.replace(/\/docs\/?/,'')
  res.redirect(301, "/" + newPath)
})

// Docs index
router.get('/', function (req, res) {
  res.render('index')
})

router.get('/install', function (req, res) {
  res.render('install')
})

// Pages in install folder are markdown
router.get('/install/:page', function (req, res) {
  // If the link already has .md on the end (for GitHub docs)
  // remove this when we render the page
  if (req.params.page.slice(-3).toLowerCase() === '.md') {
    req.params.page = req.params.page.slice(0, -3)
  }
  redirectMarkdown(req.params.page, res)
  var doc = fs.readFileSync(path.join(__dirname, '/documentation/install/', req.params.page + '.md'), 'utf8')
  var html = marked(doc)
  res.render('install_template', { 'document': html })
})

// Redirect to the zip of the latest release of the Prototype Kit on GitHub
router.get('/download', function (req, res) {
  var url = utils.getLatestRelease()
  res.redirect(url)
})

// Examples - examples post here
router.post('/tutorials-and-examples', function (req, res) {
  res.redirect('tutorials-and-examples')
})

// Example routes

// Passing data into a page
router.get('/examples/template-data', function (req, res) {
  res.render('examples/template-data', { 'name': 'Foo' })
})

// Branching
router.post('/examples/branching/over-18-answer', function (req, res) {
  // Get the answer from session data
  // The name between the quotes is the same as the 'name' attribute on the input elements
  // However in JavaScript we can't use hyphens in variable names

  let over18 = req.session.data['over-18']

  if (over18 === 'false') {
    res.redirect('/examples/branching/under-18')
  } else {
    res.redirect('/examples/branching/over-18')
  }
})

module.exports = router

// Strip off markdown extensions if present and redirect
var redirectMarkdown = function (requestedPage, res) {
  if (requestedPage.slice(-3).toLowerCase() === '.md') {
    res.redirect(requestedPage.slice(0, -3))
  }
  if (requestedPage.slice(-9).toLowerCase() === '.markdown') {
    res.redirect(requestedPage.slice(0, -9))
  }
}

// Try to match a request to a Markdown file and render it

const docsPath = '/documentation/'

router.use(function (req, res, next){
  if (fs.existsSync(path.join(__dirname, docsPath, req.path + '.md'), 'utf8')) {
    var doc = fs.readFileSync(path.join(__dirname, docsPath, req.path + '.md'), 'utf8')
    var html = marked(doc)
    res.render('documentation_template', { 'document': html })
    return
  }
  next()
})
