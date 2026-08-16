import {
  musicRoomDatabase,
  type RecommendationEventRecord
} from "@/features/library/indexeddb";
import { buildRecommendationProfile } from "./recommendation-profile";
import {
  recommendationArtistKey,
  type RecommendationEvent,
  type RecommendationFeedback,
  type RecommendationProfile
} from "./recommendation-types";

const maxEventsPerUser = 2_000;

export async function recordRecommendationFeedback(input: RecommendationFeedback) {
  const occurredAt = input.occurredAt ?? Date.now();
  const record: RecommendationEventRecord = {
    id: createEventId(input, occurredAt),
    userId: input.userId,
    candidateKey: input.candidate.key,
    title: input.candidate.title,
    artist: input.candidate.artist,
    artistKey: recommendationArtistKey(input.candidate.artist),
    source: input.candidate.source,
    eventType: input.eventType,
    contextKey: input.contextKey ?? null,
    occurredAt
  };
  await musicRoomDatabase.recommendationEvents.put(record);
  await trimRecommendationEvents(input.userId);
}

export async function getRecommendationProfile(userId: string): Promise<RecommendationProfile> {
  const records = await musicRoomDatabase.recommendationEvents
    .where("userId")
    .equals(userId)
    .toArray();
  return buildRecommendationProfile(userId, records.map(toRecommendationEvent));
}

export async function clearRecommendationProfile(userId: string) {
  await musicRoomDatabase.recommendationEvents.where("userId").equals(userId).delete();
}

async function trimRecommendationEvents(userId: string) {
  const records = await musicRoomDatabase.recommendationEvents
    .where("userId")
    .equals(userId)
    .toArray();
  if (records.length <= maxEventsPerUser) return;
  const staleIds = records
    .sort((left, right) => left.occurredAt - right.occurredAt)
    .slice(0, records.length - maxEventsPerUser)
    .map((record) => record.id);
  await musicRoomDatabase.recommendationEvents.bulkDelete(staleIds);
}

function createEventId(input: RecommendationFeedback, occurredAt: number) {
  if (input.dedupeKey) {
    return `${input.userId}:${input.eventType}:${input.dedupeKey}`;
  }
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${occurredAt}:${Math.random().toString(36).slice(2)}`;
  return `${input.userId}:${input.eventType}:${suffix}`;
}

function toRecommendationEvent(record: RecommendationEventRecord): RecommendationEvent {
  return {
    id: record.id,
    userId: record.userId,
    candidate: {
      key: record.candidateKey,
      title: record.title,
      artist: record.artist,
      source: record.source,
      baseScore: 0,
      availabilityScore: 1
    },
    eventType: record.eventType,
    contextKey: record.contextKey ?? undefined,
    occurredAt: record.occurredAt,
    artistKey: record.artistKey
  };
}
