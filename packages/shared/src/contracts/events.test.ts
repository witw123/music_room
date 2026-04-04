import { describe, expect, it } from "vitest";
import { roomChatEventSchema, websocketEventSchema } from "./events";

describe("websocket event contracts", () => {
  it("accepts room.chat as a declared websocket event", () => {
    expect(websocketEventSchema.parse("room.chat")).toBe("room.chat");
  });

  it("parses a room.chat event payload", () => {
    expect(
      roomChatEventSchema.parse({
        event: "room.chat",
        payload: {
          roomId: "room_1",
          senderId: "user_1",
          senderName: "Alice",
          content: "hello",
          timestamp: Date.now()
        }
      })
    ).toMatchObject({
      event: "room.chat",
      payload: {
        roomId: "room_1",
        senderId: "user_1",
        senderName: "Alice",
        content: "hello"
      }
    });
  });
});
