"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import type {
  PlaybackMode,
  PlaybackSnapshot,
  QueueItem,
  TrackMeta
} from "@music-room/shared";
import {
  getCachedLibraryTrack,
  type LocalPlaylistTrackRecord
} from "@/lib/indexeddb";
import {
  getLocalAudioCacheFile,
  getLocalAudioFile
} from "@/features/upload/local-audio-storage";
import { listMergedLocalPlaylistTracks } from "@/features/playlist/local-playlist";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

const localQueueOwnerId = "local-playlist";

type LocalPlayerContextValue = {
  audioRef: RefObject<HTMLAudioElement | null>;
  playback: PlaybackSnapshot | null;
  currentTrack: TrackMeta | null;
  progressMs: number;
  seekDraft: number | null;
  setSeekDraft: (value: number | null) => void;
  audioDurationMs: number;
  volume: number;
  setVolume: (value: number) => void;
  syncProgressFromAudio: () => void;
  syncDurationFromAudio: () => void;
  tracks: TrackMeta[];
  queue: QueueItem[];
  currentQueueItemId: string | null;
  canControlPlayback: boolean;
  canSeekPlayback: boolean;
  playbackMode: PlaybackMode;
  isTrackPlayable: (track: LocalPlaylistTrackRecord) => boolean;
  addToQueue: (track: LocalPlaylistTrackRecord) => void;
  playTrack: (track: LocalPlaylistTrackRecord) => Promise<void>;
  playTracks: (tracks: LocalPlaylistTrackRecord[], startIndex?: number) => Promise<void>;
  onPlay: () => void;
  onPause: (positionMs?: number) => void;
  onSeek: (positionMs: number) => Promise<PlaybackSnapshot | null>;
  onPrev: () => void;
  onNext: () => void;
  onCyclePlaybackMode: () => void;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
};

const LocalPlayerContext = createContext<LocalPlayerContextValue | null>(null);

export function LocalPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const queueRef = useRef<LocalPlaylistTrackRecord[]>([]);
  const playbackRecordsRef = useRef<LocalPlaylistTrackRecord[]>([]);
  const playbackSequenceKindRef = useRef<"queue" | "direct" | "playlist">("direct");
  const currentRecordRef = useRef<LocalPlaylistTrackRecord | null>(null);
  const currentIndexRef = useRef(0);
  const playRequestRef = useRef(0);
  const progressRef = useRef(0);
  const revisionRef = useRef(0);
  const mediaEpochRef = useRef(0);
  const [queueRecords, setQueueRecords] = useState<LocalPlaylistTrackRecord[]>([]);
  const [libraryRecords, setLibraryRecords] = useState<LocalPlaylistTrackRecord[]>([]);
  const [currentRecord, setCurrentRecord] = useState<LocalPlaylistTrackRecord | null>(null);
  const [playback, setPlayback] = useState<PlaybackSnapshot | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("sequence");

  useEffect(() => {
    queueRef.current = queueRecords;
  }, [queueRecords]);

  useEffect(() => {
    currentRecordRef.current = currentRecord;
  }, [currentRecord]);

  useEffect(() => {
    progressRef.current = progressMs;
  }, [progressMs]);

  useEffect(() => {
    setPlayback((current) => current ? { ...current, playbackMode } : current);
  }, [playbackMode]);

  useEffect(() => {
    let cancelled = false;
    void listMergedLocalPlaylistTracks()
      .then((tracks) => {
        if (!cancelled) setLibraryRecords(tracks);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const isTrackPlayable = useCallback(
    (track: LocalPlaylistTrackRecord) => Boolean(track.fileHash && (track.availableOffline || track.fileName)),
    []
  );

  const createPlaybackSnapshot = useCallback(
    (input: {
      record: LocalPlaylistTrackRecord | null;
      status: PlaybackSnapshot["status"];
      positionMs: number;
      startedAt?: string | null;
    }): PlaybackSnapshot | null => {
      if (!input.record) return null;

      revisionRef.current += 1;
      return {
        status: input.status,
        currentTrackId: input.record.id,
        currentQueueItemId: queueRef.current.some((track) => track.id === input.record?.id)
          ? buildLocalQueueItemId(input.record.id)
          : null,
        playbackAssetId: null,
        startAt: null,
        sourceSessionId: null,
        sourcePeerId: null,
        sourceTrackId: input.record.id,
        positionMs: Math.max(0, Math.round(input.positionMs)),
        startedAt: input.startedAt ?? null,
        queueVersion: 1,
        playbackRevision: revisionRef.current,
        mediaEpoch: mediaEpochRef.current,
        playbackMode
      };
    },
    [playbackMode]
  );

  const loadAudioFile = useCallback(async (track: LocalPlaylistTrackRecord) => {
    if (!track.fileHash) return null;

    const localFile = await getLocalAudioFile(
      track.fileHash,
      track.sourceDirectoryId,
      track.fileName
    );
    if (localFile) return localFile;

    const cachedFile = await getLocalAudioCacheFile(track.fileHash);
    if (cachedFile) return cachedFile;

    const cachedRecord = await getCachedLibraryTrack(track.fileHash);
    return cachedRecord?.file ?? null;
  }, []);

  const playRecords = useCallback(async (
    records: LocalPlaylistTrackRecord[],
    startIndex = 0,
    sequenceKind: "queue" | "direct" | "playlist" = "direct"
  ) => {
    const nextRecords = records.filter((track, index, list) =>
      list.findIndex((candidate) => candidate.id === track.id) === index
    );
    if (nextRecords.length === 0) return;

    const requestId = ++playRequestRef.current;
    const normalizedStartIndex = Math.min(Math.max(0, startIndex), nextRecords.length - 1);
    const shouldSkipMissingFiles = sequenceKind !== "direct" && playbackMode !== "single";
    const candidateCount = shouldSkipMissingFiles ? nextRecords.length : 1;
    let selectedIndex = normalizedStartIndex;
    let record: LocalPlaylistTrackRecord | undefined;
    let file: Blob | null = null;

    for (let offset = 0; offset < candidateCount; offset += 1) {
      const candidateIndex = playbackMode === "shuffle"
        ? (normalizedStartIndex + offset) % nextRecords.length
        : normalizedStartIndex + offset;
      if (candidateIndex >= nextRecords.length) break;
      const candidate = nextRecords[candidateIndex];
      const candidateFile = await loadAudioFile(candidate).catch(() => null);
      if (requestId !== playRequestRef.current) return;
      if (candidateFile) {
        selectedIndex = candidateIndex;
        record = candidate;
        file = candidateFile;
        break;
      }
    }

    if (!record || !file || requestId !== playRequestRef.current) return;

    const audio = audioRef.current;
    if (!audio) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    mediaEpochRef.current += 1;
    currentIndexRef.current = selectedIndex;
    playbackRecordsRef.current = nextRecords;
    playbackSequenceKindRef.current = sequenceKind;
    currentRecordRef.current = record;
    setCurrentRecord(record);
    setProgressMs(0);
    setSeekDraft(null);
    setAudioDurationMs(record.durationMs);
    setPlayback(createPlaybackSnapshot({ record, status: "paused", positionMs: 0 }));

    audio.pause();
    audio.src = objectUrl;
    audio.load();
    const playResult = await roomAudioOutput.playElement(audio, { force: true });
    if (playResult.ok) {
      if (requestId !== playRequestRef.current) return;
      const startedAt = new Date(Date.now() - audio.currentTime * 1000).toISOString();
      setPlayback(createPlaybackSnapshot({
        record,
        status: "playing",
        positionMs: audio.currentTime * 1000,
        startedAt
      }));
    } else {
      if (requestId !== playRequestRef.current) return;
      // Keep the selected track visible so the next explicit play click can
      // retry after a browser autoplay policy rejection.
      setPlayback(createPlaybackSnapshot({ record, status: "paused", positionMs: 0 }));
    }
  }, [createPlaybackSnapshot, loadAudioFile, playbackMode]);

  const playTrack = useCallback(async (track: LocalPlaylistTrackRecord) => {
    const existingIndex = queueRef.current.findIndex((candidate) => candidate.id === track.id);
    if (existingIndex >= 0) {
      await playRecords(queueRef.current, existingIndex, "queue");
      return;
    }

    const nextQueue = [...queueRef.current, track];
    queueRef.current = nextQueue;
    setQueueRecords(nextQueue);
    await playRecords(nextQueue, nextQueue.length - 1, "queue");
  }, [playRecords]);

  const playTracks = useCallback(async (
    tracksToPlay: LocalPlaylistTrackRecord[],
    startIndex = 0
  ) => {
    const uniqueTracks = tracksToPlay.filter((track, index, list) =>
      list.findIndex((candidate) => candidate.id === track.id) === index
    );
    if (uniqueTracks.length === 0) return;

    const normalizedStartIndex = Math.min(Math.max(0, startIndex), uniqueTracks.length - 1);
    const nextQueue = [...queueRef.current];
    const queueIds = new Set(nextQueue.map((track) => track.id));
    for (const track of uniqueTracks) {
      if (!queueIds.has(track.id)) {
        nextQueue.push(track);
        queueIds.add(track.id);
      }
    }
    queueRef.current = nextQueue;
    setQueueRecords(nextQueue);

    const selectedTrackId = uniqueTracks[normalizedStartIndex]?.id;
    const queueIndex = nextQueue.findIndex((track) => track.id === selectedTrackId);
    if (queueIndex >= 0) {
      await playRecords(nextQueue, queueIndex, "queue");
    }
  }, [playRecords]);

  const addToQueue = useCallback((track: LocalPlaylistTrackRecord) => {
    if (queueRef.current.some((candidate) => candidate.id === track.id)) {
      return;
    }

    const nextQueue = [...queueRef.current, track];
    queueRef.current = nextQueue;
    setQueueRecords(nextQueue);

    if (playbackSequenceKindRef.current === "queue") {
      const currentId = currentRecordRef.current?.id;
      playbackRecordsRef.current = nextQueue;
      currentIndexRef.current = Math.max(
        0,
        nextQueue.findIndex((candidate) => candidate.id === currentId)
      );
    } else if (
      playbackSequenceKindRef.current === "direct" &&
      currentRecordRef.current
    ) {
      playbackRecordsRef.current = [
        currentRecordRef.current,
        ...nextQueue.filter((candidate) => candidate.id !== currentRecordRef.current?.id)
      ];
      currentIndexRef.current = 0;
    }
  }, []);

  const onPlay = useCallback(() => {
    const record = currentRecordRef.current;
    const audio = audioRef.current;
    if (!audio) return;

    if (!record) {
      const firstQueueIndex = queueRef.current.findIndex((track) => Boolean(track.fileHash));
      if (firstQueueIndex >= 0) {
        void playRecords(queueRef.current, firstQueueIndex, "queue");
      }
      return;
    }

    void roomAudioOutput.playElement(audio, { force: true })
      .then((result) => {
        if (!result.ok) return;
        setPlayback(createPlaybackSnapshot({
          record,
          status: "playing",
          positionMs: audio.currentTime * 1000,
          startedAt: new Date(Date.now() - audio.currentTime * 1000).toISOString()
        }));
      });
  }, [createPlaybackSnapshot, playRecords]);

  const onPause = useCallback((positionMs?: number) => {
    const record = currentRecordRef.current;
    const audio = audioRef.current;
    if (!record || !audio) return;

    audio.pause();
    const nextPositionMs = positionMs ?? audio.currentTime * 1000;
    setProgressMs(nextPositionMs);
    setPlayback(createPlaybackSnapshot({ record, status: "paused", positionMs: nextPositionMs }));
  }, [createPlaybackSnapshot]);

  const onSeek = useCallback(async (positionMs: number) => {
    const record = currentRecordRef.current;
    const audio = audioRef.current;
    if (!record || !audio) return null;

    const duration = audioDurationMs || record.durationMs;
    const boundedPosition = duration > 0
      ? Math.min(Math.max(0, positionMs), duration)
      : Math.max(0, positionMs);
    audio.currentTime = boundedPosition / 1000;
    setProgressMs(boundedPosition);
    const nextPlayback = createPlaybackSnapshot({
      record,
      status: audio.paused ? "paused" : "playing",
      positionMs: boundedPosition,
      startedAt: audio.paused
        ? null
        : new Date(Date.now() - boundedPosition).toISOString()
    });
    setPlayback(nextPlayback);
    return nextPlayback;
  }, [audioDurationMs, createPlaybackSnapshot]);

  const stopAtEnd = useCallback(() => {
    const record = currentRecordRef.current;
    const audio = audioRef.current;
    if (!record) return;

    const durationMs = audioDurationMs || record.durationMs;
    if (audio && durationMs > 0) {
      audio.currentTime = durationMs / 1000;
      audio.pause();
    }
    setProgressMs(durationMs);
    setPlayback(createPlaybackSnapshot({ record, status: "paused", positionMs: durationMs }));
  }, [audioDurationMs, createPlaybackSnapshot]);

  const findPlayableIndex = useCallback(async (startIndex: number, direction: 1 | -1) => {
    const records = playbackRecordsRef.current;
    if (records.length < 2) return -1;

    for (let offset = 1; offset < records.length; offset += 1) {
      const index = startIndex + direction * offset;
      if (index < 0 || index >= records.length) break;
      const candidate = records[index];
      if (isTrackPlayable(candidate) || await loadAudioFile(candidate).catch(() => null)) return index;
    }
    return -1;
  }, [isTrackPlayable, loadAudioFile]);

  const onPrev = useCallback(() => {
    if (progressRef.current > 3000) {
      void onSeek(0);
      return;
    }
    void findPlayableIndex(currentIndexRef.current, -1).then((nextIndex) => {
      if (nextIndex >= 0) {
        void playRecords(
          playbackRecordsRef.current,
          nextIndex,
          playbackSequenceKindRef.current
        );
      }
    });
  }, [findPlayableIndex, onSeek, playRecords]);

  const onNext = useCallback(() => {
    void findPlayableIndex(currentIndexRef.current, 1).then((nextIndex) => {
      if (nextIndex >= 0) {
        void playRecords(
          playbackRecordsRef.current,
          nextIndex,
          playbackSequenceKindRef.current
        );
      } else {
        stopAtEnd();
      }
    });
  }, [findPlayableIndex, playRecords, stopAtEnd]);

  const onCyclePlaybackMode = useCallback(() => {
    setPlaybackMode((mode) => mode === "sequence" ? "shuffle" : mode === "shuffle" ? "single" : "sequence");
  }, []);

  const handleAudioEnded = useCallback(() => {
    if (playbackMode === "single") {
      void playRecords(
        playbackRecordsRef.current,
        currentIndexRef.current,
        playbackSequenceKindRef.current
      );
      return;
    }
    if (playbackMode === "shuffle") {
      const records = playbackRecordsRef.current;
      const playable = records
        .map((track, index) => ({ track, index }))
        .filter(({ track, index }) => index !== currentIndexRef.current && isTrackPlayable(track));
      const selected = playable[Math.floor(Math.random() * playable.length)];
      if (selected) {
        void playRecords(records, selected.index, playbackSequenceKindRef.current);
      } else if (isTrackPlayable(records[currentIndexRef.current])) {
        void playRecords(records, currentIndexRef.current, playbackSequenceKindRef.current);
      }
      return;
    }
    onNext();
  }, [isTrackPlayable, onNext, playbackMode, playRecords]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = volume;
    const handleEnded = () => handleAudioEnded();
    const handleTimeUpdate = () => {
      if (Number.isFinite(audio.currentTime)) {
        setProgressMs(Math.round(audio.currentTime * 1000));
      }
    };
    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDurationMs(Math.round(audio.duration * 1000));
      }
    };
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
    };
  }, [currentRecord, handleAudioEnded, volume]);

  const syncProgressFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.currentTime)) {
      setProgressMs(Math.round(audio.currentTime * 1000));
    }
  }, []);

  const syncDurationFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      setAudioDurationMs(Math.round(audio.duration * 1000));
    } else if (currentRecordRef.current?.durationMs) {
      setAudioDurationMs(currentRecordRef.current.durationMs);
    }
  }, []);

  const onPlayQueueItem = useCallback(async (queueItemId: string) => {
    const index = queueRef.current.findIndex((track) => buildLocalQueueItemId(track.id) === queueItemId);
    if (index >= 0) await playRecords(queueRef.current, index, "queue");
  }, [playRecords]);

  const onRemoveQueueItem = useCallback(async (queueItemId: string) => {
    const index = queueRef.current.findIndex((track) => buildLocalQueueItemId(track.id) === queueItemId);
    if (index < 0) return;
    const nextRecords = queueRef.current.filter((_, itemIndex) => itemIndex !== index);
    queueRef.current = nextRecords;
    setQueueRecords(nextRecords);
    if (playbackSequenceKindRef.current === "queue") {
      playbackRecordsRef.current = nextRecords;
      if (index < currentIndexRef.current) currentIndexRef.current -= 1;
    } else if (playbackSequenceKindRef.current === "direct" && currentRecordRef.current) {
      playbackRecordsRef.current = [
        currentRecordRef.current,
        ...nextRecords.filter((track) => track.id !== currentRecordRef.current?.id)
      ];
      currentIndexRef.current = 0;
    }
    if (currentRecordRef.current?.id === queueItemId.replace("local-queue:", "")) {
      onPause();
    }
  }, [onPause]);

  const onReorderQueue = useCallback(async (queueItemIds: string[]) => {
    const recordsByQueueId = new Map(
      queueRef.current.map((track) => [buildLocalQueueItemId(track.id), track] as const)
    );
    const nextRecords = queueItemIds
      .map((queueItemId) => recordsByQueueId.get(queueItemId))
      .filter((track): track is LocalPlaylistTrackRecord => Boolean(track));
    if (nextRecords.length !== queueRef.current.length) return;
    const currentId = currentRecordRef.current?.id;
    queueRef.current = nextRecords;
    setQueueRecords(nextRecords);
    if (playbackSequenceKindRef.current === "queue") {
      playbackRecordsRef.current = nextRecords;
      currentIndexRef.current = Math.max(0, nextRecords.findIndex((track) => track.id === currentId));
    } else if (playbackSequenceKindRef.current === "direct" && currentRecordRef.current) {
      playbackRecordsRef.current = [
        currentRecordRef.current,
        ...nextRecords.filter((track) => track.id !== currentRecordRef.current?.id)
      ];
      currentIndexRef.current = 0;
    }
  }, []);

  const currentTrack = useMemo(
    () => currentRecord ? toTrackMeta(currentRecord) : null,
    [currentRecord]
  );
  const tracks = useMemo(() => {
    const records = [...libraryRecords, ...queueRecords].filter((track, index, list) =>
      list.findIndex((candidate) => candidate.id === track.id) === index
    );
    return records.map(toTrackMeta);
  }, [libraryRecords, queueRecords]);
  const queue = useMemo(
    () => queueRecords.map((track, position) => ({
      id: buildLocalQueueItemId(track.id),
      trackId: track.id,
      requestedBy: "本地歌单",
      requestedById: localQueueOwnerId,
      position,
      createdAt: track.createdAt
    })),
    [queueRecords]
  );

  const value = useMemo<LocalPlayerContextValue>(() => ({
    audioRef,
    playback,
    currentTrack,
    progressMs,
    seekDraft,
    setSeekDraft,
    audioDurationMs,
    volume,
    setVolume,
    syncProgressFromAudio,
    syncDurationFromAudio,
    tracks,
    queue,
    currentQueueItemId: currentRecord && queueRecords.some((track) => track.id === currentRecord.id)
      ? buildLocalQueueItemId(currentRecord.id)
      : null,
    canControlPlayback: Boolean(currentRecord || queueRecords.length > 0),
    canSeekPlayback: Boolean(currentRecord),
    playbackMode,
    isTrackPlayable,
    addToQueue,
    playTrack,
    playTracks,
    onPlay,
    onPause,
    onSeek,
    onPrev,
    onNext,
    onCyclePlaybackMode,
    onPlayQueueItem,
    onRemoveQueueItem,
    onReorderQueue
  }), [
    audioDurationMs,
    currentRecord,
    currentTrack,
    addToQueue,
    isTrackPlayable,
    onCyclePlaybackMode,
    onNext,
    onPause,
    onPlay,
    onPlayQueueItem,
    onPrev,
    onRemoveQueueItem,
    onReorderQueue,
    onSeek,
    playTrack,
    playTracks,
    playback,
    playbackMode,
    progressMs,
    queue,
    seekDraft,
    syncDurationFromAudio,
    syncProgressFromAudio,
    tracks,
    volume,
    queueRecords
  ]);

  return <LocalPlayerContext.Provider value={value}>{children}</LocalPlayerContext.Provider>;
}

export function useLocalPlayer() {
  const context = useContext(LocalPlayerContext);
  if (!context) {
    throw new Error("useLocalPlayer must be used within LocalPlayerProvider");
  }
  return context;
}

function buildLocalQueueItemId(trackId: string) {
  return `local-queue:${trackId}`;
}

function toTrackMeta(track: LocalPlaylistTrackRecord): TrackMeta {
  const sourceRef = track.provider === "local_upload"
    ? undefined
    : { provider: track.provider, trackId: track.providerTrackId ?? track.id };

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    bitrate: null,
    sizeBytes: track.sizeBytes,
    codec: null,
    mimeType: track.mimeType,
    fileHash: track.fileHash ?? track.id,
    artworkUrl: track.artworkUrl,
    ownerSessionId: localQueueOwnerId,
    ownerNickname: "本地歌单",
    sourceType: track.provider,
    sourceRef
  };
}
