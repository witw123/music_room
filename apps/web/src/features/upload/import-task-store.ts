import { useSyncExternalStore } from "react";

export type ImportTaskType =
  | "local_files"
  | "provider_track"
  | "provider_batch"
  | "cached_track"
  | "playlist_load";

export type ImportTaskStatus = "running" | "completed" | "failed";

export interface ImportTaskItemInfo {
  key: string;
  title: string;
  stage?: string;
  percent?: number;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
}

export interface ImportTaskGroup {
  id: string;
  type: ImportTaskType;
  title: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  currentTitle?: string;
  currentStage?: string;
  currentStagePercent?: number; // 0 - 100
  overallPercent: number; // 0 - 100
  status: ImportTaskStatus;
  error?: string;
  itemKeys: string[];
  startedAt: number;
  finishedAt?: number;
}

export interface ItemImportStatus {
  isImporting: boolean;
  title?: string;
  stage?: string;
  percent?: number;
  status?: "pending" | "running" | "completed" | "failed";
}

type TaskListener = () => void;

class ImportTaskStore {
  private tasks = new Map<string, ImportTaskGroup>();
  private itemKeyIndex = new Map<string, ImportTaskItemInfo>();
  private listeners = new Set<TaskListener>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Cooldown time before a completed/failed task is removed from active tasks
  private readonly finishCooldownMs = 2500;

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore listener error
      }
    }
  }

  public subscribe = (listener: TaskListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getTasks(): ImportTaskGroup[] {
    return Array.from(this.tasks.values());
  }

  public getActiveTasks(): ImportTaskGroup[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === "running");
  }

  public getVisibleTasks(): ImportTaskGroup[] {
    // Returns running tasks, or recently finished tasks within cooldown
    return Array.from(this.tasks.values());
  }

  public getItemStatus(itemKey: string | null | undefined): ItemImportStatus {
    if (!itemKey) return { isImporting: false };
    const item = this.itemKeyIndex.get(itemKey);
    if (!item) return { isImporting: false };
    return {
      isImporting: item.status === "pending" || item.status === "running",
      title: item.title,
      stage: item.stage,
      percent: item.percent,
      status: item.status
    };
  }

  public isItemImporting(itemKey: string | null | undefined): boolean {
    if (!itemKey) return false;
    const item = this.itemKeyIndex.get(itemKey);
    return item ? item.status === "pending" || item.status === "running" : false;
  }

  public areAnyItemsImporting(itemKeys: readonly string[]): boolean {
    for (const key of itemKeys) {
      if (this.isItemImporting(key)) return true;
    }
    return false;
  }

  public startTask(input: {
    id?: string;
    type: ImportTaskType;
    title: string;
    totalCount: number;
    itemKeys?: string[];
    currentTitle?: string;
    currentStage?: string;
  }): string {
    const id = input.id ?? `import_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const totalCount = Math.max(1, input.totalCount);
    const itemKeys = input.itemKeys ?? [];

    const existingTimer = this.cleanupTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.cleanupTimers.delete(id);
    }

    const task: ImportTaskGroup = {
      id,
      type: input.type,
      title: input.title,
      totalCount,
      completedCount: 0,
      failedCount: 0,
      currentTitle: input.currentTitle,
      currentStage: input.currentStage,
      currentStagePercent: 0,
      overallPercent: 0,
      status: "running",
      itemKeys,
      startedAt: Date.now()
    };

    this.tasks.set(id, task);

    // Register items in the index
    for (const key of itemKeys) {
      this.itemKeyIndex.set(key, {
        key,
        title: input.currentTitle ?? input.title,
        status: "pending"
      });
    }

    this.notify();
    return id;
  }

  public updateTaskProgress(
    taskId: string,
    update: {
      currentTitle?: string;
      currentStage?: string;
      currentStagePercent?: number;
      completedCount?: number;
      failedCount?: number;
      activeItemKey?: string;
      activeItemAliasKeys?: string[];
    }
  ) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return;

    if (update.currentTitle !== undefined) task.currentTitle = update.currentTitle;
    if (update.currentStage !== undefined) task.currentStage = update.currentStage;
    if (update.currentStagePercent !== undefined) {
      task.currentStagePercent = Math.min(100, Math.max(0, Math.round(update.currentStagePercent)));
    }
    if (update.completedCount !== undefined) task.completedCount = update.completedCount;
    if (update.failedCount !== undefined) task.failedCount = update.failedCount;

    // Recalculate overall percentage
    const stagePortion = (task.currentStagePercent ?? 0) / 100;
    const progressCount = task.completedCount + stagePortion;
    task.overallPercent = Math.min(100, Math.max(0, Math.round((progressCount / task.totalCount) * 100)));

    // Update active item status
    if (update.activeItemKey) {
      const itemInfo: ImportTaskItemInfo = {
        key: update.activeItemKey,
        title: task.currentTitle ?? task.title,
        stage: task.currentStage,
        percent: task.currentStagePercent,
        status: "running"
      };
      this.itemKeyIndex.set(update.activeItemKey, itemInfo);
      if (update.activeItemAliasKeys) {
        for (const alias of update.activeItemAliasKeys) {
          this.itemKeyIndex.set(alias, itemInfo);
        }
      }
    }

    this.notify();
  }

  public completeItem(taskId: string, itemKey: string, aliasKeys?: string[]) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.completedCount += 1;
      const progressCount = task.completedCount;
      task.overallPercent = Math.min(100, Math.max(0, Math.round((progressCount / task.totalCount) * 100)));
    }

    const item = this.itemKeyIndex.get(itemKey);
    if (item) {
      item.status = "completed";
      item.percent = 100;
    }
    if (aliasKeys) {
      for (const alias of aliasKeys) {
        const aliasItem = this.itemKeyIndex.get(alias);
        if (aliasItem) {
          aliasItem.status = "completed";
          aliasItem.percent = 100;
        }
      }
    }
    this.notify();
  }

  public failItem(taskId: string, itemKey: string, error?: string, aliasKeys?: string[]) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.failedCount += 1;
      const progressCount = task.completedCount;
      task.overallPercent = Math.min(100, Math.max(0, Math.round((progressCount / task.totalCount) * 100)));
    }

    const item = this.itemKeyIndex.get(itemKey);
    if (item) {
      item.status = "failed";
      item.error = error;
    }
    if (aliasKeys) {
      for (const alias of aliasKeys) {
        const aliasItem = this.itemKeyIndex.get(alias);
        if (aliasItem) {
          aliasItem.status = "failed";
          aliasItem.error = error;
        }
      }
    }
    this.notify();
  }

  public finishTask(taskId: string, options?: { error?: string }) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.finishedAt = Date.now();
    if (options?.error || (task.failedCount > 0 && task.completedCount === 0)) {
      task.status = "failed";
      task.error = options?.error ?? "导入失败";
    } else {
      task.status = "completed";
      task.overallPercent = 100;
    }

    // Clean item index for this task's items
    for (const key of task.itemKeys) {
      this.itemKeyIndex.delete(key);
    }

    // Schedule task removal from visible tasks
    const timer = setTimeout(() => {
      this.tasks.delete(taskId);
      this.cleanupTimers.delete(taskId);
      this.notify();
    }, this.finishCooldownMs);

    this.cleanupTimers.set(taskId, timer);
    this.notify();
  }

  public removeTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      for (const key of task.itemKeys) {
        this.itemKeyIndex.delete(key);
      }
    }
    const timer = this.cleanupTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(taskId);
    }
    this.tasks.delete(taskId);
    this.notify();
  }

  public clearAll() {
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.tasks.clear();
    this.itemKeyIndex.clear();
    this.notify();
  }
}

export const importTaskStore = new ImportTaskStore();

// React hooks
let cachedVisibleSnapshot: ImportTaskGroup[] = [];
let lastVisibleTasks: ImportTaskGroup[] = [];

function areTaskArraysEqual(a: ImportTaskGroup[], b: ImportTaskGroup[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ta = a[i];
    const tb = b[i];
    if (
      ta.id !== tb.id ||
      ta.status !== tb.status ||
      ta.overallPercent !== tb.overallPercent ||
      ta.currentStage !== tb.currentStage ||
      ta.currentStagePercent !== tb.currentStagePercent ||
      ta.currentTitle !== tb.currentTitle ||
      ta.completedCount !== tb.completedCount ||
      ta.failedCount !== tb.failedCount ||
      ta.error !== tb.error
    ) {
      return false;
    }
  }
  return true;
}

function getVisibleTasksSnapshot(): ImportTaskGroup[] {
  const current = importTaskStore.getVisibleTasks();
  if (areTaskArraysEqual(current, lastVisibleTasks)) {
    return cachedVisibleSnapshot;
  }
  lastVisibleTasks = current;
  cachedVisibleSnapshot = [...current];
  return cachedVisibleSnapshot;
}

export function useVisibleImportTasks(): ImportTaskGroup[] {
  return useSyncExternalStore(
    importTaskStore.subscribe,
    getVisibleTasksSnapshot,
    () => []
  );
}

export function useItemImportStatus(itemKey: string | null | undefined): ItemImportStatus {
  return useSyncExternalStore(
    importTaskStore.subscribe,
    () => importTaskStore.getItemStatus(itemKey),
    () => ({ isImporting: false })
  );
}

export function useIsItemImporting(itemKey: string | null | undefined): boolean {
  return useSyncExternalStore(
    importTaskStore.subscribe,
    () => importTaskStore.isItemImporting(itemKey),
    () => false
  );
}

export function isCandidateImporting(candidate: {
  provider?: string | null;
  providerTrackId?: string | null;
  title?: string | null;
  fileHash?: string | null;
  id?: string | null;
}): boolean {
  if (candidate.fileHash && importTaskStore.isItemImporting(candidate.fileHash)) return true;
  if (candidate.id && importTaskStore.isItemImporting(candidate.id)) return true;
  if (candidate.provider && candidate.providerTrackId) {
    if (importTaskStore.isItemImporting(`${candidate.provider}:${candidate.providerTrackId}`)) return true;
    if (importTaskStore.isItemImporting(`provider:${candidate.provider}:${candidate.providerTrackId}`)) return true;
    if (importTaskStore.isItemImporting(candidate.providerTrackId)) return true;
  }
  if (candidate.title && importTaskStore.isItemImporting(candidate.title)) return true;
  return false;
}
