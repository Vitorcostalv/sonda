#!/bin/sh
set -eu
nft -f - <<'EOF'
table inet sonda {
 set denied4 {
  type ipv4_addr; flags interval;
  elements = { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4 }
 }
 chain output {
  type filter hook output priority 0; policy drop;
  ct state established,related accept
  ip daddr 1.1.1.1 udp dport 53 accept
  ip daddr 1.1.1.1 tcp dport 53 accept
  ip daddr @denied4 reject
  ip6 daddr ::/0 reject
  tcp dport {80,443} accept
 }
}
EOF
exec gosu node pnpm --filter @sonda/egress start
