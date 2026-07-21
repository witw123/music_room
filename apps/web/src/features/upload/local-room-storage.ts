"use client";

import type { RoomSnapshot } from "@music-room/shared";
import { getLocalAudioDirectory } from "@/lib/indexeddb";
import { LocalRepository } from "./local-repository";

let roomPersistenceChain = Promise.resolve();

export async function persistRoomSnapshotToLocalRepository(snapshot: RoomSnapshot) {
  const operation = roomPersistenceChain.then(async () => {
    const directory = await getLocalAudioDirectory();
    if (!directory) return false;

    const repository = await LocalRepository.open(directory.handle);
    await repository.writeRoomSnapshot(snapshot);
    return true;
  });
  roomPersistenceChain = operation.then(() => undefined, () => undefined);
  return operation;
}
