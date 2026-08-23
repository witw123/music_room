"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthSession, RoomChatMessage } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { musicRoomApi } from "@/lib/network/music-room-api";
import type { RoomSocket } from "@/lib/network/ws-client";

type RoomChatPanelProps = {
  roomId: string;
  activeSession: AuthSession | null;
  isHost: boolean;
  socket: RoomSocket | null;
  scrollEnabled?: boolean;
  onActivateScroll?: () => void;
};

export function RoomChatPanel({ roomId, activeSession, isHost, socket, scrollEnabled = true, onActivateScroll }: RoomChatPanelProps) {
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
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

    const handleChatDeleted = (payload: { roomId: string; messageId: string }) => {
      if (payload.roomId !== roomId) return;
      setMessages((current) => current.filter((message) => message.id !== payload.messageId));
    };

    socket.on("room.chat", handleChat);
    socket.on("room.chat.deleted", handleChatDeleted);
    return () => {
      socket.off("room.chat", handleChat);
      socket.off("room.chat.deleted", handleChatDeleted);
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

  const deleteMessage = async (messageId: string) => {
    if (!isHost || deletingMessageId) return;
    setDeletingMessageId(messageId);
    setErrorMessage(null);
    try {
      await musicRoomApi.deleteRoomChatMessage(roomId, messageId);
      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (error) {
      setErrorMessage(toChatErrorMessage(error));
    } finally {
      setDeletingMessageId(null);
    }
  };

  return (
    <section
      className="flex h-full min-h-[24rem] min-w-0 flex-col bg-surface/25 lg:min-h-0"
      data-testid="radio-chat-panel"
      data-scroll-enabled={scrollEnabled ? "true" : "false"}
      onFocusCapture={onActivateScroll}
      onClick={onActivateScroll}
    >
      <header className="flex shrink-0 items-center justify-between px-4 py-3.5 sm:px-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_rgba(0,112,243,0.8)]" />
          <h2 className="text-base font-semibold text-foreground">聊天</h2>
        </div>
        <span className="text-[11px] font-mono text-foreground-muted/60">{messages.length} 条互动</span>
      </header>

      <div
        className={`hide-scrollbar min-h-0 flex-1 px-4 py-3 sm:px-5 ${scrollEnabled ? "touch-pan-y overflow-y-auto overscroll-contain" : "overflow-hidden"}`}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 48) void loadOlder();
        }}
        ref={messagesRef}
      >
        {isLoading ? <p className="py-10 text-center text-sm text-foreground-muted">正在加载聊天记录...</p> : null}
        {isLoadingOlder ? <p className="pb-3 text-center text-xs text-foreground-muted">正在加载更早消息...</p> : null}
        {errorMessage ? <p className="pb-3 text-center text-xs text-danger" role="status">{errorMessage}</p> : null}
        {!isLoading && !errorMessage && !messages.length ? <p className="py-10 text-center text-sm text-foreground-muted">还没有消息，发送第一条弹幕吧！</p> : null}
        <div className="space-y-6">
          {messages.map((message) => {
            const isCurrentUser = message.senderId === activeSession?.userId;
            return (
              <article className={`group flex min-w-0 items-start gap-3 ${isCurrentUser ? "justify-end" : "justify-start"}`} key={message.id}>
                {!isCurrentUser ? <ChatAvatar name={message.senderName} /> : null}
                <div className={`min-w-0 max-w-[min(78%,32rem)] ${isCurrentUser ? "text-right" : "text-left"}`}>
                  <div className={`mb-2 flex min-w-0 items-baseline gap-2 px-0.5 ${isCurrentUser ? "justify-end" : "justify-start"}`}>
                    {!isCurrentUser ? <strong className="min-w-0 truncate text-sm font-medium text-accent/65">{message.senderName}</strong> : null}
                    <time className="shrink-0 text-xs tabular-nums text-foreground-muted/55" dateTime={new Date(message.timestamp).toISOString()}>{formatChatTime(message.timestamp)}</time>
                    {isHost ? <button aria-label={`删除 ${message.senderName} 的消息`} className="shrink-0 text-[10px] text-foreground-muted opacity-70 transition-opacity hover:text-danger hover:opacity-100 focus-visible:text-danger focus-visible:opacity-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100" disabled={deletingMessageId !== null} onClick={() => void deleteMessage(message.id)} type="button">{deletingMessageId === message.id ? "删除中" : "删除"}</button> : null}
                  </div>
                  <div className={`inline-block max-w-full rounded-[0.875rem] px-4 py-3 text-left shadow-sm ${isCurrentUser ? "bg-accent text-white" : "bg-white/[0.1] text-foreground"}`}><p className="break-words text-[15px] leading-6">{message.content}</p></div>
                </div>
                {isCurrentUser ? <ChatAvatar currentUser name={message.senderName} /> : null}
              </article>
            );
          })}
        </div>
      </div>

      <form className="flex shrink-0 gap-2 border-t border-surface-border p-3 sm:p-4 bg-background/60 backdrop-blur-md" onSubmit={handleSend}>
        <label className="sr-only" htmlFor={`radio-chat-input-${roomId}`}>发送消息</label>
        <input
          className="min-w-0 flex-1 rounded-xl border border-surface-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60 placeholder:text-foreground-muted/50"
          disabled={!socket || !activeSession}
          id={`radio-chat-input-${roomId}`}
          maxLength={500}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={socket && activeSession ? "发送消息..." : "正在连接聊天"}
          value={inputValue}
        />
        <Button disabled={!inputValue.trim() || !socket || !activeSession} size="sm" type="submit" className="rounded-xl px-4 py-2.5">发送</Button>
      </form>
    </section>
  );
}

function ChatAvatar({ name, currentUser = false }: { name: string; currentUser?: boolean }) {
  return <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold shadow-inner border border-white/10 ${currentUser ? "bg-accent/15 text-accent" : "bg-white/[0.1] text-foreground-muted"}`}>{name.slice(0, 1).toUpperCase()}</span>;
}

function mergeMessages(
  left: RoomChatMessage[],
  right: RoomChatMessage[]
) {
  const maxMessages = 500;
  const messages = new Map<string, RoomChatMessage>();
  for (const message of [...left, ...right]) messages.set(message.id, message);
  const sortedMessages = [...messages.values()].sort((first, second) =>
    first.timestamp - second.timestamp || first.id.localeCompare(second.id)
  );
  return sortedMessages.slice(-maxMessages);
}

export function formatChatTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toChatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message && !/internal server error/i.test(error.message)) {
    return error.message;
  }
  return "聊天暂时不可用，请稍后重试。";
}
