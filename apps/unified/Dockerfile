# web: the unified app served by nginx (PLT-7). Build context is apps/unified.
#   docker build --build-arg API_URL=https://<api-fqdn> -t matchcast-web apps/unified
FROM python:3.12-slim AS build
ARG API_URL=""
WORKDIR /app
COPY . .
RUN if [ -n "$API_URL" ]; then python build.py --api "$API_URL"; else python build.py; fi
# Everything the shell loads (tests/test_web_image.py checks this list against index.html).
RUN mkdir /site && cp -r index.html config.js contracts.js agents.js live.js trace-panel.js \
      speech.js status.js voice.js voices.json watch broadcast analyst shared /site/
# Pre-compress for nginx gzip_static; config.js stays plain so a deploy can overwrite it.
RUN find /site -type f -size +1k ! -name config.js \
      \( -name '*.html' -o -name '*.js' -o -name '*.json' -o -name '*.css' -o -name '*.svg' \) \
      -exec gzip -9 -k {} +
# nginx runs unprivileged; a checkout made under a strict umask must still be readable.
RUN chmod -R a+rX /site

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --chmod=644 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 8080
