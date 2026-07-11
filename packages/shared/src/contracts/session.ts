import { z } from "zod";

export const userProfileSchema = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string()
});

export const authSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  nickname: z.string(),
  createdAt: z.string().datetime()
});

export type UserProfile = z.infer<typeof userProfileSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;

// Legacy alias kept to reduce migration churn across internal modules.
export type GuestSession = AuthSession;
