"use client";

import { useState, useEffect, useRef } from "react";
import { AuthSession, RoomChatPayload } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { RoomSocket } from "@/lib/ws-client";

interface ChatMessage extends RoomChatPayload {
  id: string;
}

interface RoomChatOverlayProps {
  roomId: string;
  activeSession: AuthSession | null;
  socket: RoomSocket | null;
  compact?: boolean;
  ultraCompact?: boolean;
}

export function RoomChatOverlay({
  roomId,
  activeSession,
  socket,
  compact = false,
  ultraCompact = false
}: RoomChatOverlayProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isVisible, setIsVisible] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Auto-hide logic ONLY for messages, not the input
  useEffect(() => {
    const interval = setInterval(() => {
      // If messages stale, we can still keep them but maybe dim them? 
      // Actually per "弹幕流" request, let's keep the stream active but fade out old ones
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleChat = (payload: RoomChatPayload) => {
      const newMessage: ChatMessage = {
        ...payload,
        id: Math.random().toString(36).substring(7),
        timestamp: payload.timestamp ?? Date.now(),
      };
      setMessages((prev) => [...prev.slice(-10), newMessage]);
    };

    socket.on("room.chat", handleChat);
    return () => {
      socket.off("room.chat", handleChat);
    };
  }, [socket]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim() || !socket || !activeSession) return;

    const payload: RoomChatPayload = {
      roomId,
      senderId: activeSession.userId,
      senderName: activeSession.nickname,
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    socket.emit("room.chat", payload);
    
    setMessages((prev) => [...prev.slice(-10), { ...payload, id: Math.random().toString(36).substring(7) }]);
    setInputValue("");
  };

  return (
    <div
      className={`z-40 mx-auto flex w-full max-w-[540px] flex-col items-center px-4 ${
        ultraCompact
          ? "my-1.5 gap-1.5 px-2"
          : compact
            ? "my-2 gap-2 px-2"
            : "my-4 gap-3"
      }`}
    >
      {/* Messages Area - Glassmorphic Container */}
      <div
        className={`relative w-full border border-white/5 bg-white/[0.03] backdrop-blur-md ${
          compact ? "rounded-[1.1rem] p-1.5" : "rounded-2xl p-2"
        }`}
      >
        <div
          className={`hide-scrollbar flex w-full flex-col overflow-y-auto scroll-smooth ${
            ultraCompact
              ? "max-h-[72px] gap-1 px-1.5 py-0.5"
              : compact
                ? "max-h-[96px] gap-1 px-1.5 py-0.5"
                : "max-h-[140px] gap-1.5 px-2 py-1"
          }`}
             style={{ 
               maskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
               WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)'
             }}>
          {messages.length === 0 ? (
            <div className={`text-center ${ultraCompact ? "py-2" : compact ? "py-2.5" : "py-4"}`}>
              <p className={`italic tracking-wide text-white/20 ${ultraCompact ? "text-[9px]" : compact ? "text-[10px]" : "text-[11px]"}`}>暂时还没人说话，打破沉默...</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === activeSession?.userId;

              return (
                <div 
                  key={msg.id} 
                  className={`animate-slide-up-subtle flex items-baseline rounded-lg transition-colors ${
                    compact ? "gap-2 px-2 py-1" : "gap-2.5 px-2.5 py-1.5"
                  } ${
                    isMe ? "bg-accent/10" : "hover:bg-white/5"
                  }`}
                >
                  <span className={`shrink-0 font-black uppercase tracking-[0.15em] ${compact ? "text-[9px]" : "text-[10px]"} ${
                    isMe ? "text-accent" : "text-white/40"
                  }`}>
                    {msg.senderName}
                  </span>
                  <p className={`flex-1 break-words text-white/80 ${ultraCompact ? "text-[11px] leading-snug" : compact ? "text-[12px] leading-snug" : "text-[13px] leading-relaxed"}`}>
                    {msg.content}
                  </p>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="group relative flex w-full items-center gap-2">
        <div className="absolute -inset-1 rounded-full bg-accent/10 blur opacity-0 transition-opacity group-focus-within:opacity-100" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="分享你的感受..."
          className={`relative flex-1 rounded-full border border-white/10 bg-black/40 text-white placeholder:text-white/20 transition-all focus:outline-none focus:ring-1 focus:ring-accent/40 backdrop-blur-3xl ${
            ultraCompact
              ? "px-3.5 py-1.5 text-[12px]"
              : compact
                ? "px-4 py-1.5 text-[13px]"
                : "px-5 py-2 text-sm"
          }`}
        />
        <Button 
            size="icon" 
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className={`relative shrink-0 rounded-full bg-accent/90 text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent active:scale-90 disabled:grayscale disabled:opacity-30 ${
              compact ? "h-8 w-8" : "h-9 w-9"
            }`}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
        </Button>
      </div>
    </div>
  );
}
