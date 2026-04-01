"use client";

import { musicRoomDatabase } from "@/lib/indexeddb";

const appStoragePrefixes = ["music-room-"];
const indexedDbName = "music-room";

function clearStorageByPrefix(storage: Storage, prefixes: string[]) {
  const keysToDelete: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }

    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    storage.removeItem(key);
  }
}

function clearAppCookies(prefixes: string[]) {
  if (typeof document === "undefined") {
    return;
  }

  const cookieNames = document.cookie
    .split(";")
    .map((entry) => entry.trim().split("=")[0])
    .filter(Boolean)
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));

  for (const cookieName of cookieNames) {
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

async function clearIndexedDb() {
  try {
    await musicRoomDatabase.delete();
  } catch {
    try {
      await musicRoomDatabase.close();
      await new Promise<void>((resolve) => {
        const request = window.indexedDB.deleteDatabase(indexedDbName);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    } catch {
      // Keep going; stale IndexedDB is non-fatal for the rest of the cleanup.
    }
  }
}

async function clearCacheStorage() {
  if (typeof window === "undefined" || !("caches" in window)) {
    return;
  }

  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
  } catch {
    // Ignore cache storage failures; a page reload still helps recover most cases.
  }
}

export async function clearMusicRoomLocalCache() {
  if (typeof window === "undefined") {
    return;
  }

  clearStorageByPrefix(window.localStorage, appStoragePrefixes);
  clearStorageByPrefix(window.sessionStorage, appStoragePrefixes);
  clearAppCookies(appStoragePrefixes);
  await clearIndexedDb();
  await clearCacheStorage();
}
