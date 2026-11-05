# Caddy with the Route53 DNS module, for the wildcard certificate of the sites domain.
# Build:  docker build -t circi-caddy deploy/caddy
# Other DNS providers: swap `caddy-dns/route53` for their module (one line below).
FROM caddy:2-builder AS build
RUN xcaddy build --with github.com/caddy-dns/route53

FROM caddy:2
COPY --from=build /usr/bin/caddy /usr/bin/caddy
