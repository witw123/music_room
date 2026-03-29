declare module "socket.io-client" {
  export function io(...args: any[]): {
    emit: (...emitArgs: any[]) => void;
    on: (...onArgs: any[]) => void;
    disconnect: () => void;
  };
}
