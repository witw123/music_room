import { describe, expect, it } from "vitest";
import { resolveMissingOwnedUploadedTracks } from "./use-track-uploads";

describe("resolveMissingOwnedUploadedTracks", () => {
  it("returns only the current user's room tracks that lost their playable upload binding", () => {
    expect(
      resolveMissingOwnedUploadedTracks({
        activeSessionId: "user_a",
        roomTracks: [
          {
            id: "track_owned_missing",
            fileHash: "hash-a",
            ownerSessionId: "user_a"
          },
          {
            id: "track_owned_ready",
            fileHash: "hash-b",
            ownerSessionId: "user_a"
          },
          {
            id: "track_other_user",
            fileHash: "hash-c",
            ownerSessionId: "user_b"
          }
        ],
        uploadedTracks: {
          track_owned_ready: {
            file: new File(["ready"], "ready.mp3", { type: "audio/mpeg" }),
            objectUrl: "blob:ready",
            origin: "live-upload"
          }
        }
      })
    ).toEqual([
      {
        id: "track_owned_missing",
        fileHash: "hash-a",
        ownerSessionId: "user_a"
      }
    ]);
  });

  it("returns an empty plan when there is no active room owner session", () => {
    expect(
      resolveMissingOwnedUploadedTracks({
        activeSessionId: null,
        roomTracks: [
          {
            id: "track_owned_missing",
            fileHash: "hash-a",
            ownerSessionId: "user_a"
          }
        ],
        uploadedTracks: {}
      })
    ).toEqual([]);
  });
});
