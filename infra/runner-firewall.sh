#!/bin/sh
set -eu
# Native kernel barrier: browser processes cannot bypass this policy with JS or DNS.
nft -f - <<'EOF'
table inet sonda {
 chain output {
  type filter hook output priority 0; policy drop;
  ct state established,related accept
  oifname "lo" accept
  ip daddr 172.30.20.3 tcp dport 4200 accept
  ip daddr 172.30.20.4 tcp dport 8080 accept
 }
}
EOF
exec gosu pwuser pnpm --filter @sonda/runner start
