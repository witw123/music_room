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
          id: "chat_1",
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
        id: "chat_1",
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
        content: " hello "
      })
    ).toEqual({
      roomId: "room_1",
      content: "hello"
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
