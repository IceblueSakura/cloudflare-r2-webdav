# cloudflare-r2-webdav

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/IceblueSakura/cloudflare-r2-webdav)

Use Cloudflare Workers to provide a WebDav interface for Cloudflare R2.

## Usage

Change wrangler.toml to your own.

```toml
[[r2_buckets]]
binding = 'bucket' # valid JavaScript variable name, don't change this
bucket_name = 'webdav'
```

Then use wrangler to deploy.

```bash
wrangler deploy

wrangler secret put USERNAME
wrangler secret put PASSWORD
```

## Development

With `wrangler`, you can build, test, and deploy your Worker with the following commands:

```sh
# run your Worker in an ideal development workflow (with a local server, file watcher & more)
$ pnpm run dev

# deploy your Worker globally to the Cloudflare network (update your wrangler.toml file for configuration)
$ pnpm run deploy
```

Read the latest `worker` crate documentation here: https://docs.rs/worker
