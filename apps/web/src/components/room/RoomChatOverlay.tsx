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

  // Auto-hide logic
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 10000 && messages.length > 0) {
        setIsVisible(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [messages.length]);

  useEffect(() => {
    if (!socket) return;

    const handleChat = (payload: RoomChatPayload) => {
      const newMessage: ChatMessage = {
        ...payload,
        id: Math.random().toString(36).substring(7),
        timestamp: payload.timestamp ?? Date.now(),
      };
      setMessages((prev) => [...prev.slice(-15), newMessage]);
      setIsVisible(true);
      lastActivityRef.current = Date.now();
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
    
    // Add locally immediately
    setMessages((prev) => [...prev.slice(-15), { ...payload, id: Math.random().toString(36).substring(7) }]);
    setInputValue("");
    setIsVisible(true);
    lastActivityRef.current = Date.now();
  };

  return (
    <div 
      className={`absolute bottom-32 left-8 z-40 flex flex-col gap-4 transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      }`}
      onMouseMove={() => {
          setIsVisible(true);
          lastActivityRef.current = Date.now();
      }}
    >
      <div className="flex max-h-[300px] w-[320px] flex-col gap-2 overflow-y-auto no-scrollbar mask-fade-top">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`group animate-slide-up-subtle flex flex-col gap-1 rounded-2xl bg-white/5 p-3 backdrop-blur-md border border-white/5 transition-all hover:bg-white/10 ${
                msg.senderId === activeSession?.id ? "border-accent/20 bg-accent/5" : ""
            }`}
          >
            <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    msg.senderId === activeSession?.id ? "text-accent" : "text-white/40"
                }`}>
                    {msg.senderName}
                </span>
            </div>
            <p className="text-sm text-white/90 leading-relaxed break-words">{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex items-center gap-2 w-[320px]">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
              setInputValue(e.target.value);
              lastActivityRef.current = Date.now();
          }}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="聊聊此时的音乐氛围..."
          className="flex-1 rounded-full bg-white/5 border border-white/10 px-4 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-accent/50 backdrop-blur-md transition-all focus:bg-white/10"
        />
        <Button 
            size="icon" 
            onClick={handleSend}
            className="h-9 w-9 rounded-full bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20 transition-transform active:scale-95"
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
        </Button>
      </div>
    </div>
  );
}
