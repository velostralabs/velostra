import http from 'http'
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ echoed: true, received: JSON.parse(body || '{}') }))
  })
}).listen(9099, () => console.log('mock agent listening on :9099'))
