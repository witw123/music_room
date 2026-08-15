import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RoomChatDeletedPayload, RoomChatHistoryResponse, RoomChatMessage } from "@music-room/shared";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import { assertHost, assertMember } from "../room-mutation";
import { RoomRecordRepository } from "../repositories/room-record.repository";

const historyPageSize = 50;
const historyRetentionLimit = 500;

type StoredRoomChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: Date;
};

type RoomChatMessageDelegate = {
  create: (input: { data: Omit<StoredRoomChatMessage, "createdAt"> }) => Promise<StoredRoomChatMessage>;
  findUnique: (input: { where: { id: string } }) => Promise<Pick<StoredRoomChatMessage, "id" | "roomId"> | null>;
  findMany: (input: {
    where: { roomId: string };
    orderBy: Array<{ createdAt: "asc" | "desc" } | { id: "asc" | "desc" }>;
    take?: number;
    skip?: number;
    cursor?: { id: string };
  }) => Promise<StoredRoomChatMessage[]>;
  deleteMany: (input: { where: { id: { in: string[] } } }) => Promise<{ count: number }>;
};

@Injectable()
export class RoomChatService {
  constructor(
    private readonly roomRecordRepository: RoomRecordRepository,
    private readonly prisma: PrismaService
  ) {}

  async listHistory(
    roomId: string,
    sessionId: string,
    before?: string
  ): Promise<RoomChatHistoryResponse> {
    await this.assertRadioMember(roomId, sessionId);
    const messages = this.getMessages();

    if (before) {
      const cursor = await messages.findUnique({ where: { id: before } });
      if (!cursor || cursor.roomId !== roomId) {
        throw new BadRequestException("聊天记录游标无效。");
      }
    }

    const rows = await messages.findMany({
      where: { roomId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: historyPageSize + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {})
    });
    const page = rows.slice(0, historyPageSize);
    const nextCursor = rows.length > historyPageSize ? page.at(-1)?.id ?? null : null;

    return {
      messages: [...page].reverse().map(toChatMessage),
      nextCursor
    };
  }

  async append(input: {
    roomId: string;
    sessionId: string;
    senderName: string;
    content: string;
  }): Promise<RoomChatMessage> {
    await this.assertRadioMember(input.roomId, input.sessionId);
    const messages = this.getMessages();
    const message = await messages.create({
      data: {
        id: `chat_${randomUUID()}`,
        roomId: input.roomId,
        senderId: input.sessionId,
        senderName: input.senderName,
        content: input.content
      }
    });

    const expired = await messages.findMany({
      where: { roomId: input.roomId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: historyRetentionLimit
    });
    if (expired.length) {
      await messages.deleteMany({ where: { id: { in: expired.map((item) => item.id) } } });
    }

    return toChatMessage(message);
  }

  async deleteMessage(
    roomId: string,
    sessionId: string,
    messageId: string
  ): Promise<RoomChatDeletedPayload> {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    if (record.room.roomType !== "radio") {
      throw new BadRequestException("只有自由电台支持聊天记录。");
    }
    try {
      assertHost(record, sessionId);
    } catch {
      throw new ForbiddenException("只有房主可以删除聊天消息。");
    }

    const messages = this.getMessages();
    const message = await messages.findUnique({ where: { id: messageId } });
    if (!message || message.roomId !== roomId) {
      throw new NotFoundException("聊天消息不存在。");
    }
    await messages.deleteMany({ where: { id: { in: [messageId] } } });
    return { roomId, messageId };
  }

  private async assertRadioMember(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    assertMember(record, sessionId);
    if (record.room.roomType !== "radio") {
      throw new BadRequestException("只有自由电台支持聊天记录。");
    }
  }

  private getMessages() {
    if (!this.prisma.isAvailable()) {
      throw new ServiceUnavailableException("聊天记录服务暂不可用。");
    }
    return (this.prisma as PrismaService & { roomChatMessage: RoomChatMessageDelegate }).roomChatMessage;
  }
}

function toChatMessage(message: StoredRoomChatMessage): RoomChatMessage {
  return {
    id: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    timestamp: message.createdAt.getTime()
  };
}
