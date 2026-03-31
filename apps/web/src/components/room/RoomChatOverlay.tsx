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
    <div className="z-40 flex w-full max-w-[540px] flex-col items-center gap-3 px-4 mx-auto my-4">
      {/* Messages Area - Glassmorphic Container */}
      <div className="relative w-full rounded-2xl bg-white/[0.03] border border-white/5 p-2 backdrop-blur-md">
        <div className="flex max-h-[140px] w-full flex-col gap-1.5 overflow-y-auto thin-scrollbar scroll-smooth py-1 px-2"
             style={{ 
               maskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
               WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)'
             }}>
          {messages.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-[11px] text-white/20 italic tracking-wide">暂时还没人说话，打破沉默...</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === activeSession?.id;

              return (
                <div 
                  key={msg.id} 
                  className={`animate-slide-up-subtle flex items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                    isMe ? "bg-accent/10" : "hover:bg-white/5"
                  }`}
                >
                  <span className={`shrink-0 text-[10px] font-black uppercase tracking-[0.15em] ${
                    isMe ? "text-accent" : "text-white/40"
                  }`}>
                    {msg.senderName}
                  </span>
                  <p className="text-[13px] leading-relaxed text-white/80 break-words flex-1">
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
          className="relative flex-1 rounded-full border border-white/10 bg-black/40 backdrop-blur-3xl px-5 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-accent/40 transition-all"
        />
        <Button 
            size="icon" 
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="relative h-9 w-9 shrink-0 rounded-full bg-accent/90 hover:bg-accent text-white shadow-lg shadow-accent/20 transition-all active:scale-90 disabled:opacity-30 disabled:grayscale"
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
