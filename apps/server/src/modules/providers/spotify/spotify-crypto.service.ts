import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isValidEncryptionKey } from "../../../common/config/runtime-config";

const cipherAlgorithm = "aes-256-gcm";
const encodingVersion = "v1";

@Injectable()
export class SpotifyCryptoService {
  encrypt(value: string) {
    const key = resolveEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(cipherAlgorithm, key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      encodingVersion,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url")
    ].join(":");
  }

  decrypt(value: string) {
    const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
    if (version !== encodingVersion || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error("Invalid Spotify credentials encryption payload.");
    }

    const decipher = createDecipheriv(
      cipherAlgorithm,
      resolveEncryptionKey(),
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  }
}

function resolveEncryptionKey() {
  const value = process.env.SPOTIFY_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!value || !isValidEncryptionKey(value)) {
    throw new Error(
      "SPOTIFY_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex or base64 key when Spotify is enabled."
    );
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  return Buffer.from(value, "base64");
}
