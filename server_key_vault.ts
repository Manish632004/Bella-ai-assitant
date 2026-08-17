/**
 * Secure Machine-Bound Encrypted Key Vault (AES-256-GCM)
 * Stores raw Gemini API keys encrypted on disk using machine-specific cryptographic derivation.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import { DATA_DIR } from "./server_paths";

const VAULT_FILE = path.join(DATA_DIR, "keys_vault.enc");
const SALT_FILE = path.join(DATA_DIR, ".vault_salt");

interface VaultEntry {
  id: string;
  ciphertext: string;
  iv: string;
  tag: string;
}

interface VaultStore {
  version: number;
  entries: Record<string, VaultEntry>;
}

class KeyVault {
  private encryptionKey: Buffer;

  constructor() {
    this.encryptionKey = this.deriveMachineKey();
  }

  private deriveMachineKey(): Buffer {
    // Ensure persistent unique salt
    let salt: Buffer;
    try {
      if (fs.existsSync(SALT_FILE)) {
        salt = Buffer.from(fs.readFileSync(SALT_FILE, "utf-8").trim(), "hex");
      } else {
        salt = crypto.randomBytes(32);
        fs.writeFileSync(SALT_FILE, salt.toString("hex"), "utf-8");
        try {
          fs.chmodSync(SALT_FILE, 0o600);
        } catch {}
      }
    } catch {
      salt = crypto.createHash("sha256").update("bella-vault-default-salt").digest();
    }

    // Combine hardware/machine properties for machine-bound key derivation
    const machineFingerprint = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.userInfo().username,
      salt.toString("hex")
    ].join("::");

    return crypto.scryptSync(machineFingerprint, salt, 32);
  }

  private readVault(): VaultStore {
    try {
      if (fs.existsSync(VAULT_FILE)) {
        const raw = fs.readFileSync(VAULT_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.entries) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("[KeyVault] Warning reading vault, starting clean store:", e);
    }
    return { version: 1, entries: {} };
  }

  private writeVault(store: VaultStore): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(VAULT_FILE, JSON.stringify(store, null, 2), "utf-8");
      try {
        fs.chmodSync(VAULT_FILE, 0o600);
      } catch {}
    } catch (e) {
      console.error("[KeyVault] Failed writing encrypted vault:", e);
    }
  }

  public storeRawKey(id: string, rawKey: string): void {
    const trimmed = rawKey.trim();
    if (!trimmed) throw new Error("Key cannot be empty");

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    
    let ciphertext = cipher.update(trimmed, "utf-8", "hex");
    ciphertext += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");

    const store = this.readVault();
    store.entries[id] = {
      id,
      ciphertext,
      iv: iv.toString("hex"),
      tag
    };
    this.writeVault(store);
  }

  public getRawKey(id: string): string | null {
    const store = this.readVault();
    const entry = store.entries[id];
    if (!entry) return null;

    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey,
        Buffer.from(entry.iv, "hex")
      );
      decipher.setAuthTag(Buffer.from(entry.tag, "hex"));

      let decrypted = decipher.update(entry.ciphertext, "hex", "utf-8");
      decrypted += decipher.final("utf-8");
      return decrypted;
    } catch (e) {
      console.error(`[KeyVault] Failed to decrypt key for id ${id}:`, e);
      return null;
    }
  }

  public deleteRawKey(id: string): boolean {
    const store = this.readVault();
    if (store.entries[id]) {
      delete store.entries[id];
      this.writeVault(store);
      return true;
    }
    return false;
  }

  public hasRawKey(id: string): boolean {
    const store = this.readVault();
    return Boolean(store.entries[id]);
  }
}

export const keyVault = new KeyVault();
