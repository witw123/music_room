import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const radioRoomSource = readFileSync(new URL("./RadioRoomView.tsx", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("./RoomChatOverlay.tsx", import.meta.url), "utf8");

describe("RadioRoomView layout", () => {
  it("uses the larger player and chat split for the first desktop viewport", () => {
    expect(radioRoomSource).toContain('data-testid="radio-room-hero"');
    expect(radioRoomSource).toContain("lg:grid-cols-[minmax(0,64fr)_minmax(22rem,36fr)]");
    expect(radioRoomSource).toContain("hideRoomMetadata: true, showMobilePlayer: true");
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

  it("matches the reference chat message hierarchy", () => {
    expect(chatSource).toContain("text-accent/65");
    expect(chatSource).toContain("rounded-[0.875rem]");
    expect(chatSource).toContain("h-12 w-12");
    expect(chatSource).toContain("getFullYear()");
    expect(chatSource.indexOf("formatChatTime(message.timestamp)")).toBeLessThan(chatSource.indexOf("message.content"));
  });
});
