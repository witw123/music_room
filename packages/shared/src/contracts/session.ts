import { z } from "zod";

export const guestSessionSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  token: z.string(),
  createdAt: z.string().datetime()
});

export type GuestSession = z.infer<typeof guestSessionSchema>;

