import { describe, expect, it } from "vitest";
import {
  formatDuration,
  getOnlineMemberCount,
  getReconnectingMemberCount,
  normalizePlaylistTitle,
  removeTracksFromUploads,
  shouldAcceptPresenceRevision,
  shouldAcceptPlaybackSnapshot,
  shouldReplacePlaybackSnapshot,
  toUserFacingError
} from "./music-room-ui";

describe("music-room-ui helpers", () => {
  it("falls back to the default playlist title when the input is blank", () => {
    expect(normalizePlaylistTitle("   ")).toBe("Tonight Selects");
    expect(normalizePlaylistTitle("夜间精选")).toBe("夜间精选");
  });

  it("maps backend errors to user-facing Chinese copy", () => {
    expect(toUserFacingError(new Error("Nickname already exists in this room"))).toBe(
      "这个昵称已经在房间里被使用了，请换一个再加入。"
    );
    expect(toUserFacingError(new Error("Queue item not found in this room."))).toBe(
      "这首歌已经不在当前播放队列里了。"
    );
    expect(
      toUserFacingError(
        new Error("Track owner is not online, so this song cannot be played right now.")
      )
    ).toBe("这首歌的上传者当前不在线，暂时无法播放。");
  });

  it("removes evicted uploads from the in-memory track map", () => {
    expect(
      removeTracksFromUploads(
        {
          a: { objectUrl: "blob:a" },
          b: { objectUrl: "blob:b" },
          c: { objectUrl: "blob:c" }
        },
        ["b", "c"]
      )
    ).toEqual({
      a: { objectUrl: "blob:a" }
    });
  });

  it("counts only members with active peer ids as online", () => {
    expect(
      getOnlineMemberCount([
        {
          id: "host",
          nickname: "Host",
          role: "host",
          joinedAt: new Date().toISOString(),
          peerId: "peer-host",
          presenceState: "online"
        },
        {
          id: "member",
          nickname: "Member",
          role: "member",
          joinedAt: new Date().toISOString(),
          peerId: null,
          presenceState: "offline"
        }
      ])
    ).toBe(1);
  });

  it("counts reconnecting members separately from online members", () => {
    expect(
      getReconnectingMemberCount([
        {
          id: "host",
          nickname: "Host",
          role: "host",
          joinedAt: new Date().toISOString(),
          peerId: "peer-host",
          presenceState: "online"
        },
        {
          id: "member",
          nickname: "Member",
          role: "member",
          joinedAt: new Date().toISOString(),
          peerId: null,
          presenceState: "reconnecting"
        }
      ])
    ).toBe(1);
  });

  it("formats milliseconds into player-friendly timestamps", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(61_000)).toBe("1:01");
  });

  it("accepts only presence snapshots that are at least as new as the current revision", () => {
    expect(shouldAcceptPresenceRevision(3, 3)).toBe(true);
    expect(shouldAcceptPresenceRevision(3, 4)).toBe(true);
    expect(shouldAcceptPresenceRevision(4, 3)).toBe(false);
  });

  it("ignores identical playback snapshots at the same version", () => {
    const current = {
      status: "playing" as const,
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "host_1",
      sourcePeerId: "peer_host",
      sourceTrackId: "track_1",
      positionMs: 12_000,
      startedAt: "2026-04-03T12:00:00.000Z",
      queueVersion: 5,
      mediaEpoch: 3
    };

    expect(shouldAcceptPlaybackSnapshot(current, { ...current })).toBe(true);
    expect(shouldReplacePlaybackSnapshot(current, { ...current })).toBe(false);
    expect(
      shouldReplacePlaybackSnapshot(current, {
        ...current,
        sourcePeerId: "peer_host_reconnected"
      })
    ).toBe(true);
    expect(
      shouldAcceptPlaybackSnapshot(current, {
        ...current,
        queueVersion: 6
      })
    ).toBe(true);
  });
});
