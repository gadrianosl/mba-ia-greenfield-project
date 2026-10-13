#!/bin/sh
set -eu

# Bootstrap HTTPS using the official Node image's built-in public trust roots.
# A managed proxy may supply its public CA through an optional BuildKit mount.
node -e "require('fs').writeFileSync('/tmp/streamtube-bootstrap-ca.crt', require('tls').rootCertificates.join('\n')+'\n')"
if [ -f /run/secrets/proxy_ca ]; then
  cat /run/secrets/proxy_ca >> /tmp/streamtube-bootstrap-ca.crt
fi
chmod 644 /tmp/streamtube-bootstrap-ca.crt
sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources
export https_proxy="${HTTPS_PROXY:-}"
apt-get -o Acquire::https::CaInfo=/tmp/streamtube-bootstrap-ca.crt update
apt-get -o Acquire::https::CaInfo=/tmp/streamtube-bootstrap-ca.crt install -y --no-install-recommends ca-certificates "$@"
if [ -f /run/secrets/proxy_ca ]; then
  cp /run/secrets/proxy_ca /usr/local/share/ca-certificates/environment-proxy-ca.crt
  chmod 644 /usr/local/share/ca-certificates/environment-proxy-ca.crt
  update-ca-certificates
fi
rm -f /tmp/streamtube-bootstrap-ca.crt
rm -rf /var/lib/apt/lists/*
