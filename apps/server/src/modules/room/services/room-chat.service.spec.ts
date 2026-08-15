import { BadRequestException } from "@nestjs/common";
import { RoomChatService } from "./room-chat.service";

describe("RoomChatService", () => {
  it("returns chronological pages and trims the oldest messages beyond the retention limit", async () => {
    const prisma = createPrismaMock();
    const service = new RoomChatService(createRoomRepository("radio") as never, prisma as never);

    for (let index = 0; index < 501; index += 1) {
      await service.append({
        roomId: "room_1",
        sessionId: "member_1",
        senderName: "Member",
        content: `message-${index}`
      });
    }

    expect(prisma.messages).toHaveLength(500);
    expect(prisma.messages.some((message) => message.content === "message-0")).toBe(false);

    const latest = await service.listHistory("room_1", "member_1");
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages[0]?.content).toBe("message-451");
    expect(latest.messages.at(-1)?.content).toBe("message-500");
    expect(latest.nextCursor).not.toBeNull();

    const older = await service.listHistory("room_1", "member_1", latest.nextCursor ?? undefined);
    expect(older.messages[0]?.content).toBe("message-401");
    expect(older.messages.at(-1)?.content).toBe("message-450");
  });

  it("rejects non-radio rooms and non-members", async () => {
    const prisma = createPrismaMock();
    const nonRadio = new RoomChatService(createRoomRepository("interactive") as never, prisma as never);
    await expect(nonRadio.listHistory("room_1", "member_1")).rejects.toBeInstanceOf(BadRequestException);

    const radio = new RoomChatService(createRoomRepository("radio") as never, prisma as never);
    await expect(radio.listHistory("room_1", "outsider")).rejects.toThrow("Only room members");
  });
});

type StoredMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: Date;
};

function createPrismaMock() {
  const messages: StoredMessage[] = [];
  let sequence = 0;
  return {
    messages,
    isAvailable: jest.fn().mockReturnValue(true),
    roomChatMessage: {
      create: jest.fn(async ({ data }: { data: Omit<StoredMessage, "createdAt"> }) => {
        const message = {
          ...data,
          createdAt: new Date(Date.UTC(2026, 7, 15, 0, 0, sequence++))
        };
        messages.push(message);
        return message;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        messages.find((message) => message.id === where.id) ?? null
      ),
      findMany: jest.fn(async ({ where, take, skip = 0, cursor }: {
        where: { roomId: string };
        take?: number;
        skip?: number;
        cursor?: { id: string };
      }) => {
        const ordered = messages
          .filter((message) => message.roomId === where.roomId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
        const cursorIndex = cursor ? ordered.findIndex((message) => message.id === cursor.id) : -1;
        const start = cursorIndex >= 0 ? cursorIndex + skip : skip;
        return ordered.slice(start, take === undefined ? undefined : start + take);
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        const deleted = new Set(where.id.in);
        const before = messages.length;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (deleted.has(messages[index].id)) messages.splice(index, 1);
        }
        return { count: before - messages.length };
      })
    }
  };
}

function createRoomRepository(roomType: "interactive" | "radio") {
  return {
    getRoomRecord: jest.fn().mockResolvedValue({
      room: {
        roomType,
        members: [{ id: "member_1" }]
      }
    })
  };
}
