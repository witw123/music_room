"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  customLayoutCanvas,
  customLayoutItemLabels,
  customLayoutPageIds,
  customLayoutPageLabels,
  getDefaultCustomLayoutSettings,
  type CustomLayoutItem,
  type CustomLayoutItemId,
  type CustomLayoutPageId,
  type CustomLayoutSettings
} from "@/features/settings/settings-store";

type CustomLayoutEditorProps = {
  value: CustomLayoutSettings;
  onChange: (value: CustomLayoutSettings) => void;
  onClose: () => void;
};

type DragState = {
  pointerId: number;
  itemId: CustomLayoutItemId;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  initialItem: CustomLayoutItem;
};

const gridSize = 8;
const minimumItemSizes: Record<CustomLayoutItemId, { width: number; height: number }> = {
  sidebar: { width: 48, height: 180 },
  content: { width: 360, height: 300 },
  player: { width: 360, height: 48 },
  "mobile-navigation": { width: 480, height: 48 }
};

const itemColors: Record<CustomLayoutItemId, string> = {
  sidebar: "#8b5cf6",
  content: "#007aff",
  player: "#f59e0b",
  "mobile-navigation": "#10b981"
};

export function CustomLayoutEditor({ value, onChange, onClose }: CustomLayoutEditorProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [pageId, setPageId] = useState<CustomLayoutPageId>("home");
  const [selectedItemId, setSelectedItemId] = useState<CustomLayoutItemId>("content");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!selectedItemId || dragRef.current) return;
      if (!canvasRef.current || (document.activeElement !== canvasRef.current && !canvasRef.current.contains(document.activeElement))) return;
      const direction = getKeyboardDirection(event.key);
      if (!direction) return;
      const item = draftRef.current.pages[pageId][selectedItemId];
      if (item.locked) return;
      event.preventDefault();
      const amount = event.shiftKey ? gridSize * 4 : gridSize;
      const nextItem = clampItem({
        ...item,
        x: item.x + direction.x * amount,
        y: item.y + direction.y * amount
      }, selectedItemId);
      updatePageItem(pageId, selectedItemId, nextItem, true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pageId, selectedItemId]);

  const currentPage = draft.pages[pageId];
  const selectedItem = currentPage[selectedItemId];

  function setDraftValue(next: CustomLayoutSettings) {
    draftRef.current = next;
    setDraft(next);
  }

  function updatePageItem(
    targetPageId: CustomLayoutPageId,
    itemId: CustomLayoutItemId,
    item: CustomLayoutItem,
    persist: boolean
  ) {
    const next = {
      ...draftRef.current,
      pages: {
        ...draftRef.current.pages,
        [targetPageId]: {
          ...draftRef.current.pages[targetPageId],
          [itemId]: item
        }
      }
    };
    setDraftValue(next);
    if (persist) onChange(next);
  }

  function updateSelectedItem(itemId: CustomLayoutItemId, patch: Partial<CustomLayoutItem>) {
    const item = draftRef.current.pages[pageId][itemId];
    updatePageItem(pageId, itemId, { ...item, ...patch }, true);
  }

  function restorePage() {
    const defaults = getDefaultCustomLayoutSettings();
    const next = {
      ...draftRef.current,
      pages: {
        ...draftRef.current.pages,
        [pageId]: defaults.pages[pageId]
      }
    };
    setDraftValue(next);
    onChange(next);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = getCanvasPoint(event, canvasRef.current);
    if (!point) return;

    const dx = snap(point.x - drag.startX);
    const dy = snap(point.y - drag.startY);
    const nextItem = drag.mode === "move"
      ? clampItem({
          ...drag.initialItem,
          x: drag.initialItem.x + dx,
          y: drag.initialItem.y + dy
        }, drag.itemId)
      : clampItem({
          ...drag.initialItem,
          width: drag.initialItem.width + dx,
          height: drag.initialItem.height + dy
        }, drag.itemId);
    updatePageItem(pageId, drag.itemId, nextItem, false);
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onChange(draftRef.current);
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, itemId: CustomLayoutItemId, mode: DragState["mode"]) {
    event.stopPropagation();
    canvasRef.current?.focus({ preventScroll: true });
    setSelectedItemId(itemId);
    const item = draftRef.current.pages[pageId][itemId];
    if (item.locked) return;
    const point = getCanvasPoint(event, canvasRef.current);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      itemId,
      mode,
      startX: point.x,
      startY: point.y,
      initialItem: { ...item }
    };
  }

  const editor = (
    <div aria-label="自定义界面编辑器" aria-modal="true" className="fixed inset-0 z-[120] flex flex-col bg-background/95 text-foreground backdrop-blur-2xl" role="dialog">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-surface-border px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <LayoutIcon />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">自定义界面</h2>
            <p className="truncate text-[11px] text-foreground-muted">编辑 {customLayoutPageLabels[pageId]} 的桌面布局</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button className="gap-2" onClick={restorePage} size="sm" type="button" variant="outline">
            <ResetIcon />
            恢复当前页
          </Button>
          <Button aria-label="关闭自定义界面编辑器" onClick={onClose} size="icon" title="关闭编辑器" type="button" variant="ghost">
            <CloseIcon />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="flex shrink-0 gap-1 overflow-x-auto border-b border-surface-border px-3 py-2 lg:w-44 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-2 lg:py-4">
          <p className="hidden px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-muted lg:block">页面</p>
          {customLayoutPageIds.map((item) => (
            <button
              aria-current={pageId === item ? "page" : undefined}
              className={`flex h-10 shrink-0 items-center rounded-lg px-3 text-left text-xs font-medium transition-colors ${pageId === item ? "bg-accent text-white shadow-[0_6px_18px_var(--accent-glow)]" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
              key={item}
              onClick={() => setPageId(item)}
              type="button"
            >
              {customLayoutPageLabels[item]}
            </button>
          ))}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex w-full max-w-[1120px] min-w-[720px] flex-1 flex-col justify-center gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] text-foreground-muted">
                <GridIcon />
                <span>网格吸附 · 1440 × 900</span>
              </div>
            </div>
            <div
              className="relative w-full overflow-hidden rounded-2xl border border-surface-border bg-background-secondary shadow-[0_24px_80px_rgba(0,0,0,0.28)] touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              onPointerDown={(event) => {
                canvasRef.current?.focus({ preventScroll: true });
                if (event.target === event.currentTarget) setSelectedItemId("content");
              }}
              onPointerMove={handleCanvasPointerMove}
              onPointerCancel={handleCanvasPointerUp}
              onPointerUp={handleCanvasPointerUp}
              tabIndex={0}
              ref={canvasRef}
              style={{ aspectRatio: `${customLayoutCanvas.width} / ${customLayoutCanvas.height}` }}
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(to right, color-mix(in srgb, var(--foreground) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 7%, transparent) 1px, transparent 1px)", backgroundSize: `${(gridSize / customLayoutCanvas.width) * 100}% ${(gridSize / customLayoutCanvas.height) * 100}%` }} />
              {(Object.entries(currentPage) as Array<[CustomLayoutItemId, CustomLayoutItem]>).map(([itemId, item]) => (
                <LayoutCanvasItem
                  item={item}
                  itemId={itemId}
                  key={itemId}
                  onPointerDown={beginDrag}
                  selected={selectedItemId === itemId}
                />
              ))}
            </div>
          </div>
        </main>

        <aside className="w-full shrink-0 border-t border-surface-border bg-surface/25 px-4 py-3 lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:px-4 lg:py-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold">组件</h3>
              <p className="mt-1 text-[11px] text-foreground-muted">当前页布局</p>
            </div>
            <span className="text-[10px] tabular-nums text-foreground-muted">{Object.keys(currentPage).length}</span>
          </div>
          <div className="space-y-2">
            {(Object.entries(currentPage) as Array<[CustomLayoutItemId, CustomLayoutItem]>).map(([itemId, item]) => (
              <div className={`rounded-xl border p-2 transition-colors ${selectedItemId === itemId ? "border-accent/60 bg-accent/8" : "border-surface-border bg-background-secondary/45"}`} key={itemId}>
                <button className="flex w-full min-w-0 items-center gap-2 text-left" onClick={() => setSelectedItemId(itemId)} type="button">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: itemColors[itemId] }} />
                  <span className={`min-w-0 flex-1 truncate text-xs font-medium ${item.visible ? "text-foreground" : "text-foreground-muted line-through"}`}>{customLayoutItemLabels[itemId]}</span>
                  <span className="text-[10px] tabular-nums text-foreground-muted">{item.width} × {item.height}</span>
                </button>
                <div className="mt-2 flex items-center justify-end gap-1">
                  <button aria-label={`${item.visible ? "隐藏" : "显示"}${customLayoutItemLabels[itemId]}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition hover:bg-surface-hover hover:text-foreground" onClick={() => updateSelectedItem(itemId, { visible: !item.visible })} title={item.visible ? "隐藏" : "显示"} type="button">
                    {item.visible ? <EyeIcon /> : <EyeOffIcon />}
                  </button>
                  <button aria-label={`${item.locked ? "解锁" : "锁定"}${customLayoutItemLabels[itemId]}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition hover:bg-surface-hover hover:text-foreground" onClick={() => updateSelectedItem(itemId, { locked: !item.locked })} title={item.locked ? "解锁" : "锁定"} type="button">
                    {item.locked ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {selectedItem ? (
            <div className="mt-5 border-t border-surface-border pt-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: itemColors[selectedItemId] }} />
                <h3 className="text-xs font-semibold">{customLayoutItemLabels[selectedItemId]}</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-foreground-muted">
                <Metric label="横坐标" value={selectedItem.x} />
                <Metric label="纵坐标" value={selectedItem.y} />
                <Metric label="宽度" value={selectedItem.width} />
                <Metric label="高度" value={selectedItem.height} />
              </div>
              <p className="mt-3 text-[10px] leading-4 text-foreground-muted">{selectedItem.locked ? "组件已锁定" : "组件可编辑"}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );

  return portalTarget ? createPortal(editor, portalTarget) : null;
}

function LayoutCanvasItem({
  item,
  itemId,
  onPointerDown,
  selected
}: {
  item: CustomLayoutItem;
  itemId: CustomLayoutItemId;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, itemId: CustomLayoutItemId, mode: DragState["mode"]) => void;
  selected: boolean;
}) {
  const color = itemColors[itemId];
  return (
    <div
      aria-label={customLayoutItemLabels[itemId]}
      className={`absolute select-none overflow-hidden rounded-lg border text-[10px] font-semibold shadow-lg transition-[box-shadow,opacity] ${selected ? "z-20 shadow-[0_0_0_2px_var(--accent),0_12px_30px_rgba(0,0,0,0.25)]" : "z-10"} ${item.visible ? "opacity-100" : "opacity-35"}`}
      onPointerDown={(event) => onPointerDown(event, itemId, "move")}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 18%, var(--background-secondary))`,
        borderColor: selected ? "var(--accent)" : `color-mix(in srgb, ${color} 55%, transparent)`,
        color,
        height: `${(item.height / customLayoutCanvas.height) * 100}%`,
        left: `${(item.x / customLayoutCanvas.width) * 100}%`,
        minWidth: 36,
        top: `${(item.y / customLayoutCanvas.height) * 100}%`,
        width: `${(item.width / customLayoutCanvas.width) * 100}%`
      }}
    >
      <div className="flex h-full min-w-0 items-center gap-1.5 px-2">
        <MoveIcon />
        <span className="truncate">{customLayoutItemLabels[itemId]}</span>
        {item.locked ? <LockIcon /> : null}
      </div>
      {selected && !item.locked ? (
        <div aria-label={`调整${customLayoutItemLabels[itemId]}大小`} className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize" onPointerDown={(event) => onPointerDown(event, itemId, "resize")} title="调整大小">
          <span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2" style={{ borderColor: color }} />
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-surface-border bg-background-secondary/55 px-2.5 py-2">
      <span className="block text-[10px]">{label}</span>
      <span className="mt-1 block tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function getCanvasPoint(event: ReactPointerEvent, canvas: HTMLDivElement | null) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (customLayoutCanvas.width / rect.width),
    y: (event.clientY - rect.top) * (customLayoutCanvas.height / rect.height)
  };
}

function snap(value: number) {
  return Math.round(value / gridSize) * gridSize;
}

function clampItem(item: CustomLayoutItem, itemId: CustomLayoutItemId): CustomLayoutItem {
  const minimum = minimumItemSizes[itemId];
  const width = Math.min(customLayoutCanvas.width, Math.max(minimum.width, Math.round(item.width)));
  const height = Math.min(customLayoutCanvas.height, Math.max(minimum.height, Math.round(item.height)));
  return {
    ...item,
    x: Math.min(customLayoutCanvas.width - width, Math.max(0, snap(item.x))),
    y: Math.min(customLayoutCanvas.height - height, Math.max(0, snap(item.y))),
    width,
    height
  };
}

function getKeyboardDirection(key: string) {
  if (key === "ArrowLeft") return { x: -1, y: 0 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return null;
}

function LayoutIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><rect height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="7" x="3" y="3" /><rect height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="7" x="14" y="3" /><rect height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="7" x="3" y="14" /><rect height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="7" x="14" y="14" /></svg>;
}

function GridIcon() {
  return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="M4 4h16M4 12h16M4 20h16M4 4v16M12 4v16M20 4v16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>;
}

function MoveIcon() {
  return <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 24 24" width="12"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function EyeIcon() {
  return <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

function EyeOffIcon() {
  return <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15"><path d="m3 3 18 18M10.6 6.2A9.5 9.5 0 0 1 12 6c6.1 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.8M6.2 6.7C3.8 8.4 2.5 12 2.5 12s3.4 6 9.5 6c1 0 1.9-.2 2.7-.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function LockIcon() {
  return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><rect height="10" rx="2" stroke="currentColor" strokeWidth="1.7" width="14" x="5" y="10" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></svg>;
}

function UnlockIcon() {
  return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><rect height="10" rx="2" stroke="currentColor" strokeWidth="1.7" width="14" x="5" y="10" /><path d="M8 10V7a4 4 0 0 1 7.4-2.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" /></svg>;
}

function ResetIcon() {
  return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="M4 5v5h5M5 10a8 8 0 1 1 2.3 7.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}
