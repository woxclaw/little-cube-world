# Little Cube World

A persistent, real-time shared JavaScript world. Each WebSocket connection receives a server-generated visitor ID, can move a tiny avatar, drop cubes that persist in Durable Object SQLite storage, and teleport next to another connected visitor.

## Deployments

- Front end: Cloudflare Worker static assets, with a Cloudflare Pages mirror
- API and persistent state: Cloudflare Worker plus Durable Object SQLite

## Local use

```sh
npm install
cd api && npx wrangler dev
```

For local front-end work, serve `public/` and set `API_ORIGIN` in `public/app.js` to the local Worker URL.
