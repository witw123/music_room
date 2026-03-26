import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type { Server } from "socket.io";
import type { PeerSignalMessage } from "@music-room/shared";

@WebSocketGateway({
  namespace: "/ws",
  cors: { origin: "*" }
})
export class SignalingGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage("peer.signal")
  handleSignal(@MessageBody() payload: PeerSignalMessage) {
    this.server.emit("peer.signal", payload);
    return payload;
  }
}

