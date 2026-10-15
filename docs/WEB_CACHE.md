# Frontend Cache Policy

The Aliyun site serves the Vite build from `/var/www/yanwu` using Nginx.
HTML and `/sw.js` must use `Cache-Control: no-store` so browsers load current
releases. Keep hashed assets from previous releases available for open tabs.

Add these locations to the existing HTTPS server block, preserving the API
proxy and Certbot settings:

```nginx
location = /sw.js {
    add_header Cache-Control "no-store" always;
    try_files $uri =404;
}

location = /index.html {
    add_header Cache-Control "no-store" always;
    try_files $uri =404;
}

location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location / {
    add_header Cache-Control "no-store" always;
    try_files $uri $uri/ /index.html;
}
```

Back up `/etc/nginx/sites-available/yanwu`, run `nginx -t`, and reload Nginx
only after validation. Verify `/learning`, `/index.html`, `/sw.js`, an existing
hashed asset and a missing asset (404) after deployment.

The service worker stores only navigation HTML and static shell assets, never
API responses or attachments. Activation removes only older `yanwu-shell-*`
caches. Navigation bypasses the HTTP cache, and offline fallback is limited to
HTML navigation. An update does not reload an open tab or clear login storage.
If a tab already runs an older release, finish saving edits and reload it.

Run the worker regression checks with:

```sh
node --test tests/service_worker.test.mjs
```
