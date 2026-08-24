/**
 * BELLA 6.0 — Local HTTPS authority for the Phone Companion.
 *
 * Browsers only expose microphone, push notifications, geolocation and PWA
 * installation on a *secure context*. On a LAN the phone reaches this PC by
 * raw IP, which is never trusted — unless the PC itself runs its own
 * certificate authority and the user installs that CA on the phone (a one-
 * time, six-tap operation). Everything stays local: the CA private key never
 * leaves this machine, no third party participates.
 */
import os from "os";
import crypto from "crypto";
import * as forge from "node-forge";
import { readSecretJson, writeSecretJson, dataFilePath } from "./util";

const CERTS_FILE = dataFilePath("phone_certs.json");
export const HTTPS_PORT = parseInt(process.env.BELLA_HTTPS_PORT || "4443", 10);

interface StoredCerts {
  caCert: string;       // PEM
  caKey: string;        // PEM
  serverCert: string;   // PEM
  serverKey: string;    // PEM
  sans: string[];       // host IPs the current server cert was issued for
  issuedAt: string;
}

let cached: StoredCerts | null | undefined; // undefined = not yet ensured
let ensuring: Promise<StoredCerts | null> | null = null;

function lanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal && !/^169\.254\./.test(net.address)) out.push(net.address);
    }
  }
  return out;
}

function buildCerts(): StoredCerts {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = keys.publicKey;
  caCert.serialNumber = crypto.randomBytes(8).toString("hex");
  caCert.validity.notBefore = new Date(Date.now() - 60 * 60 * 1000);
  caCert.validity.notAfter = new Date(); caCert.validity.notAfter.setFullYear(caCert.validity.notAfter.getFullYear() + 10);
  const caAttrs = [
    { name: "commonName", value: "BELLA Local CA" },
    { name: "organizationName", value: "BELLA" },
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([{ name: "basicConstraints", cA: true, critical: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }]);
  caCert.sign(keys.privateKey, forge.md.sha256.create());

  const srvKeys = forge.pki.rsa.generateKeyPair(2048);
  const srvCert = forge.pki.createCertificate();
  srvCert.publicKey = srvKeys.publicKey;
  srvCert.serialNumber = crypto.randomBytes(8).toString("hex");
  srvCert.validity.notBefore = new Date(Date.now() - 60 * 60 * 1000);
  srvCert.validity.notAfter = new Date(); srvCert.validity.notAfter.setFullYear(srvCert.validity.notAfter.getFullYear() + 2);
  srvCert.setSubject([{ name: "commonName", value: os.hostname() }]);
  srvCert.setIssuer(caCert.subject.attributes);
  const ips = ["127.0.0.1", ...lanIps()];
  srvCert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [
      { type: 2, value: "localhost" },                       // DNS
      ...ips.map(ip => ({ type: 7, ip })),                   // IP
    ] },
  ]);
  srvCert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    caCert: forge.pki.certificateToPem(caCert),
    caKey: forge.pki.privateKeyToPem(keys.privateKey),
    serverCert: forge.pki.certificateToPem(srvCert),
    serverKey: forge.pki.privateKeyToPem(srvKeys.privateKey),
    sans: ips,
    issuedAt: new Date().toISOString(),
  };
}

/** Generate (once) or refresh (if LAN IPs changed) the local CA + server cert. */
export async function ensureCerts(): Promise<StoredCerts | null> {
  if (cached !== undefined) return cached;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    try {
      const stored = readSecretJson<StoredCerts | null>(CERTS_FILE, null);
      const ips = ["127.0.0.1", ...lanIps()];
      const stale = stored && (stored.sans.join(",") !== ips.join(","));
      let certs = stored && !stale ? stored : null;
      if (!certs) {
        console.log(`[Phone Certs] ${stored ? "LAN changed — reissuing" : "Generating"} local CA + server certificate…`);
        certs = buildCerts();
        writeSecretJson(CERTS_FILE, certs);
      }
      cached = certs;
      return certs;
    } catch (err) {
      console.warn("[Phone Certs] Certificate setup failed — companion falls back to HTTP-only:", err?.message || err);
      cached = null;
      return null;
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

export function httpsReady(): boolean {
  return !!cached;
}

export function tlsOptions(): { key: string; cert: string } | null {
  if (!cached) return null;
  return { key: cached.serverKey, cert: cached.serverCert };
}

/** The PEM the phone installs as a trusted authority. */
export function caCertPem(): string {
  return cached?.caCert || "";
}
