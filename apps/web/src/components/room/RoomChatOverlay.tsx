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
}

export function RoomChatOverlay({ roomId, activeSession, socket }: RoomChatOverlayProps) {
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
      senderId: activeSession.id,
      senderName: activeSession.nickname,
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    socket.emit("room.chat", payload);
    
    setMessages((prev) => [...prev.slice(-10), { ...payload, id: Math.random().toString(36).substring(7) }]);
    setInputValue("");
  };

  return (
    <div className="absolute bottom-6 left-1/2 z-40 flex w-full max-w-[520px] -translate-x-1/2 flex-col items-center gap-3 px-4">
      {/* Messages Scroll Area - Horizontal Layout */}
      <div className="flex max-h-[160px] w-full flex-col gap-1 overflow-y-auto no-scrollbar mask-fade-top scroll-smooth">
        {messages.map((msg) => {
          const isMe = msg.senderId === activeSession?.id;

          return (
            <div 
              key={msg.id} 
              className={`animate-slide-up-subtle flex items-baseline gap-2.5 rounded-lg px-3 py-1.5 transition-colors hover:bg-white/5 ${
                isMe ? "bg-accent/5" : ""
              }`}
            >
              <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wider ${
                isMe ? "text-accent" : "text-white/50"
              }`}>
                {msg.senderName}
              </span>
              <p className="text-[13px] leading-relaxed text-white/90 break-words flex-1">
                {msg.content}
              </p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="group relative flex w-full items-center gap-2">
        <div className="absolute -inset-1 rounded-full bg-accent/15 blur opacity-0 transition-opacity group-focus-within:opacity-100" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="分享你对这首歌的感受..."
          className="relative flex-1 rounded-full border border-white/10 bg-[#0a0a0a]/70 backdrop-blur-3xl px-5 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-accent/30 transition-all"
        />
        <Button 
            size="icon" 
            onClick={handleSend}
            className="relative h-10 w-10 shrink-0 rounded-full bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20 transition-transform active:scale-95"
        >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
        </Button>
      </div>
    </div>
  );
}
