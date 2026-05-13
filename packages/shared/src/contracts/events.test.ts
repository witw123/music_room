import { describe, expect, it } from "vitest";
import { roomChatEventSchema, roomChatInputPayloadSchema, websocketEventSchema } from "./events";

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

  it("trims and validates client room.chat input", () => {
    expect(
      roomChatInputPayloadSchema.parse({
        roomId: "room_1",
        content: " hello ",
        timestamp: 1
      })
    ).toEqual({
      roomId: "room_1",
      content: "hello",
      timestamp: 1
    });

    expect(() =>
      roomChatInputPayloadSchema.parse({
        roomId: "room_1",
        senderId: "forged",
        content: ""
      })
    ).toThrow();
  });
});
