import { execFileSync } from "node:child_process";
// Probes run from the container's unprivileged identity and use synthetic addresses.
const checks = [
  [
    "runner",
    "node",
    "-e",
    `const net=require('net');let results=0;for(const host of ['10.0.0.1','169.254.169.254','1.1.1.1']){let done=false;const finish=()=>{if(done)return;done=true;if(++results===3)process.exit(0)};const s=net.connect({host,port:80});s.setTimeout(1500);s.on('connect',()=>process.exit(1));s.on('error',finish);s.on('timeout',()=>{finish();s.destroy()});}`,
  ],
  [
    "runner",
    "node",
    "-e",
    `fetch('http://172.30.20.4:8080/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
  ],
];
for (const args of checks) {
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "--user", "pwuser", ...args],
    { stdio: "inherit" },
  );
}
console.log(
  "Native runner network barrier verified: private, metadata and direct internet blocked; approved fixture reachable.",
);
