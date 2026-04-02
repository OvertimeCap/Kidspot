import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getDerivedKey(): Buffer {
  const seed = process.env.AI_CRYPTO_SECRET || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "kidspot-dev-fallback-secret-key";
  return crypto.scryptSync(seed, "kidspot-ai-salt-v1", KEY_LEN);
}

export function encryptApiKey(plaintext: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptApiKey(ciphertext: string): string {
  const key = getDerivedKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 8) return "••••••••";
  const prefix = plaintext.slice(0, 6);
  return prefix + "••••••••";
}
