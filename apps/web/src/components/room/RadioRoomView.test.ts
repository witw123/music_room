import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const radioRoomSource = readFileSync(new URL("./RadioRoomView.tsx", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("./RoomChatOverlay.tsx", import.meta.url), "utf8");

describe("RadioRoomView layout", () => {
  it("uses the larger player and chat split for the first desktop viewport", () => {
    expect(radioRoomSource).toContain('data-testid="radio-room-hero"');
    expect(radioRoomSource).toContain("lg:grid-cols-[minmax(0,64fr)_minmax(22rem,36fr)]");
    expect(radioRoomSource.indexOf("<RoomStage")).toBeLessThan(radioRoomSource.indexOf("<RoomChatPanel"));
  });

  it("moves the library, host console, and members into the second viewport", () => {
    expect(radioRoomSource).toContain('data-testid="radio-room-workspace"');
    expect(radioRoomSource.indexOf("<RadioLibraryList")).toBeGreaterThan(radioRoomSource.indexOf('data-testid="radio-room-workspace"'));
    expect(radioRoomSource).toContain("<HostBroadcastDesk");
    expect(radioRoomSource).toContain("<RadioMembersPanel");
    expect(radioRoomSource).not.toContain("RadioCommunityPanels");
  });

  it("lets chat scrolling hand control back to the room page at its boundary", () => {
    expect(chatSource).toContain("flex h-full min-h-[24rem]");
    expect(chatSource).not.toContain("lg:overscroll-contain");
  });
});
