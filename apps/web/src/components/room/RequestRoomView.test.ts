import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const requestRoomSource = readFileSync(new URL("./RequestRoomView.tsx", import.meta.url), "utf8");

describe("RequestRoomView layout", () => {
  it("keeps the player and request desk in the first desktop viewport", () => {
    expect(requestRoomSource).toContain('data-testid="request-room-hero"');
    expect(requestRoomSource).toContain("lg:h-full lg:min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(26rem,0.9fr)]");
    expect(requestRoomSource).toContain("buildRoomStageProps(props, { showMobilePlayer: true })");
    expect(requestRoomSource.indexOf("<RoomStage")).toBeLessThan(requestRoomSource.indexOf("点歌台"));
  });

  it("removes the redundant request desk explanation and pending count", () => {
    expect(requestRoomSource).not.toContain("审核成员点歌，自己的点歌会直接加入队列。");
    expect(requestRoomSource).not.toContain("首待处理");
  });

  it("reuses queue, library, and member components in the second viewport", () => {
    expect(requestRoomSource).toContain('data-testid="request-room-workspace"');
    expect(requestRoomSource).toContain("<PlayerQueueList");
    expect(requestRoomSource).toContain("<LibraryTabPanel");
    expect(requestRoomSource).toContain("<MembersPanel");
  });
});
