/*
 * Generate a locally-trusted TLS certificate chain for nginx (port 8443).
 *
 * Produces:
 *   ca.pem      – root CA; install THIS on your phone/tablet
 *   ca-key.pem  – CA private key (keep secret, never install on devices)
 *   cert.pem    – server certificate (hostname/IPs from this machine)
 *   key.pem     – server private key
 *
 * A browser only treats the origin as "secure" (needed for PWA install and
 * Web Push) when it trusts the certificate. A bare self-signed cert with no
 * subjectAltName is rejected outright, so we sign the server cert with our own
 * CA and you trust the CA once per device.
 *
 * Usage:
 *   node nginx/ssl/generate.mjs
 *   node nginx/ssl/generate.mjs 192.168.1.50 homst.local
 */
import { spawnSync } from "node:child_process"
import { writeFileSync, rmSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))

function lanIPv4() {
  const found = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) found.push(addr.address)
    }
  }
  return found
}

const isIPv4 = (value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value)

const sanEntries = [
  "DNS:localhost",
  "IP:127.0.0.1",
  ...lanIPv4().map((ip) => `IP:${ip}`),
  ...process.argv.slice(2).map((host) => (isIPv4(host) ? `IP:${host}` : `DNS:${host}`)),
]
const san = [...new Set(sanEntries)].join(",")

function openssl(args) {
  const result = spawnSync("openssl", args, { stdio: "inherit" })
  if (result.error) {
    console.error(`\nCould not run openssl: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Some OpenSSL builds (notably Strawberry Perl on Windows) ship a broken
// default config path. Give `req` an explicit, self-contained config.
const configPath = join(dir, "openssl.cnf")
writeFileSync(
  configPath,
  `[ req ]\ndistinguished_name = dn\nprompt = no\n\n[ dn ]\nCN = homst\n`,
)

// ── Root CA ──────────────────────────────────────────────────────────
openssl([
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
  "-config", configPath,
  "-keyout", join(dir, "ca-key.pem"),
  "-out", join(dir, "ca.pem"),
  "-subj", "/CN=HOMST Local CA/O=HOMST",
  "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
  "-addext", "keyUsage=critical,digitalSignature,keyCertSign",
  "-addext", "subjectKeyIdentifier=hash",
])

// ── Server key + CSR ─────────────────────────────────────────────────
openssl([
  "req", "-newkey", "rsa:2048", "-nodes", "-sha256",
  "-config", configPath,
  "-keyout", join(dir, "key.pem"),
  "-out", join(dir, "cert.csr"),
  "-subj", "/CN=homst",
])

// ── Sign the server cert with the CA ─────────────────────────────────
const extensions = `basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${san}
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
`
const extPath = join(dir, "leaf.ext")
writeFileSync(extPath, extensions)

openssl([
  "x509", "-req", "-sha256", "-days", "825",
  "-in", join(dir, "cert.csr"),
  "-CA", join(dir, "ca.pem"),
  "-CAkey", join(dir, "ca-key.pem"),
  "-CAcreateserial",
  "-extfile", extPath,
  "-out", join(dir, "cert.pem"),
])

rmSync(join(dir, "cert.csr"), { force: true })
rmSync(extPath, { force: true })
rmSync(join(dir, "ca.srl"), { force: true })
rmSync(configPath, { force: true })

console.log(`
Done. Certificates written to ${dir}
  cert.pem  <->  key.pem   (used by nginx)
  ca.pem                    (install on your devices)

Subject alternative names: ${san}

Next steps:
  1. Restart nginx:  docker compose -f docker-compose.prod.yml restart nginx
  2. Install ca.pem on each phone:
     Android: copy ca.pem to the device, then
              Settings > Security & privacy > More security settings >
              Encryption & credentials > Install a certificate > CA certificate
     iOS:     AirDrop/mail ca.pem, install the profile, then
              Settings > General > About > Certificate Trust Settings > enable full trust
  3. Reload https://<this-host-ip>:8443 — the padlock should be valid,
     and Chrome will now offer "Install app".
`)
