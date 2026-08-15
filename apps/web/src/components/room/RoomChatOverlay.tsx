"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthSession, RoomChatMessage } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { musicRoomApi } from "@/lib/network/music-room-api";
import type { RoomSocket } from "@/lib/network/ws-client";

type RoomChatPanelProps = {
  roomId: string;
  activeSession: AuthSession | null;
  socket: RoomSocket | null;
};

export function RoomChatPanel({ roomId, activeSession, socket }: RoomChatPanelProps) {
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setNextCursor(null);
    setErrorMessage(null);
    setIsLoading(true);

    void musicRoomApi.listRoomChatHistory(roomId)
      .then((history) => {
        if (!active) return;
        setMessages((current) => mergeMessages(current, history.messages));
        setNextCursor(history.nextCursor);
        requestAnimationFrame(() => {
          const list = messagesRef.current;
          if (list) list.scrollTop = list.scrollHeight;
        });
      })
      .catch((error) => {
        if (active) setErrorMessage(toChatErrorMessage(error));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (!socket) return;

    const handleChat = (message: RoomChatMessage) => {
      if (message.roomId !== roomId) return;
      const list = messagesRef.current;
      const shouldFollow = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      setMessages((current) => mergeMessages(current, [message]));
      if (shouldFollow) {
        requestAnimationFrame(() => {
          const nextList = messagesRef.current;
          if (nextList) nextList.scrollTop = nextList.scrollHeight;
        });
      }
    };

    socket.on("room.chat", handleChat);
    return () => {
      socket.off("room.chat", handleChat);
    };
  }, [roomId, socket]);

  const loadOlder = useCallback(async () => {
    if (!nextCursor || isLoadingOlder) return;
    const list = messagesRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    const previousTop = list?.scrollTop ?? 0;
    setIsLoadingOlder(true);
    setErrorMessage(null);

    try {
      const history = await musicRoomApi.listRoomChatHistory(roomId, nextCursor);
      setMessages((current) => mergeMessages(history.messages, current));
      setNextCursor(history.nextCursor);
      requestAnimationFrame(() => {
        const nextList = messagesRef.current;
        if (nextList) nextList.scrollTop = previousTop + nextList.scrollHeight - previousHeight;
      });
    } catch (error) {
      setErrorMessage(toChatErrorMessage(error));
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, nextCursor, roomId]);

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = inputValue.trim();
    if (!content || !socket || !activeSession) return;
    socket.emit("room.chat", { roomId, content });
    setInputValue("");
  };

  return (
    <section className="flex min-h-[24rem] min-w-0 flex-col bg-surface/25" data-testid="radio-chat-panel">
      <header className="shrink-0 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">聊天</h2>
      </header>

      <div
        className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5"
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 48) void loadOlder();
        }}
        ref={messagesRef}
      >
        {isLoading ? <p className="py-10 text-center text-sm text-foreground-muted">正在加载聊天记录...</p> : null}
        {isLoadingOlder ? <p className="pb-3 text-center text-xs text-foreground-muted">正在加载更早消息...</p> : null}
        {!isLoading && !messages.length ? <p className="py-10 text-center text-sm text-foreground-muted">还没有消息。</p> : null}
        <div className="space-y-3">
          {messages.map((message) => {
            const isCurrentUser = message.senderId === activeSession?.userId;
            return (
              <article className={`min-w-0 border-l-2 px-3 py-1 ${isCurrentUser ? "border-accent bg-accent/[0.06]" : "border-white/15"}`} key={message.id}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <strong className={`truncate text-xs ${isCurrentUser ? "text-accent" : "text-foreground"}`}>{message.senderName}</strong>
                  <time className="shrink-0 font-mono text-[10px] text-foreground-muted" dateTime={new Date(message.timestamp).toISOString()}>{formatChatTime(message.timestamp)}</time>
                </div>
                <p className="mt-1 break-words text-sm leading-6 text-foreground-muted">{message.content}</p>
              </article>
            );
          })}
        </div>
      </div>

      <form className="flex shrink-0 gap-2 border-t border-surface-border p-3 sm:p-4" onSubmit={handleSend}>
        <label className="sr-only" htmlFor={`radio-chat-input-${roomId}`}>发送消息</label>
        <input
          className="min-w-0 flex-1 border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!socket || !activeSession}
          id={`radio-chat-input-${roomId}`}
          maxLength={500}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={socket && activeSession ? "发送消息" : "正在连接聊天"}
          value={inputValue}
        />
        <Button disabled={!inputValue.trim() || !socket || !activeSession} size="sm" type="submit">发送</Button>
      </form>
      {errorMessage ? <p className="border-t border-danger/25 px-4 py-2 text-xs text-danger" role="status">{errorMessage}</p> : null}
    </section>
  );
}

function mergeMessages(
  left: RoomChatMessage[],
  right: RoomChatMessage[]
) {
  const messages = new Map<string, RoomChatMessage>();
  for (const message of [...left, ...right]) messages.set(message.id, message);
  return [...messages.values()].sort((first, second) =>
    first.timestamp - second.timestamp || first.id.localeCompare(second.id)
  );
}

function formatChatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function toChatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "聊天记录暂时不可用。";
}
