import { expect, type Page } from "@playwright/test";

// `StorageRootGate` blocks /app, /rooms and /room until a storage root exists,
// and a fresh browser context has none: IndexedDB starts empty, so the app
// renders the authorization screen instead of the app. Every spec that enters
// the app therefore has to grant a root first.
//
// The real picker cannot be driven headlessly, so `showDirectoryPicker` is
// stubbed with a real OPFS directory handle. It has to be a genuine
// `FileSystemDirectoryHandle`: the app stores it in IndexedDB, which means it
// must be structured-cloneable, and it must survive a reload the same way the
// user's chosen folder does.

export const storageRootAuthorizeLabel = "选择或授权根目录";

type PickerStubOptions = { rootName: string };

type DirectoryPickerWindow = Window & {
  showDirectoryPicker: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

function installStorageRootPickerStub({ rootName }: PickerStubOptions) {
  (window as DirectoryPickerWindow).showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(rootName, { create: true });
  };
}

/** Must run before the page's first navigation; safe to call more than once. */
export async function stubStorageRootPicker(page: Page) {
  await page.addInitScript(installStorageRootPickerStub, { rootName: "e2e-storage-root" });
}

/**
 * Presses the gate's authorize button when it is up, and asserts the gate is
 * clear afterwards. A context that already holds an authorized root (a reload,
 * a later navigation) shows no button and needs nothing, so this is a no-op
 * there rather than a failure.
 */
export async function authorizeStorageRoot(page: Page) {
  const button = page.getByRole("button", { name: storageRootAuthorizeLabel });
  // The gate renders the button only once its first check has settled; the
  // wait also covers a reload, where the check runs again.
  if (await button.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await button.click();
  }
  await expect(button, "the storage root gate still blocks the app: no root was authorized").toHaveCount(0);
}
