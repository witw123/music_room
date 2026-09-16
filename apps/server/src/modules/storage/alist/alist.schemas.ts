import { z } from "zod";

export const alistTestConfigBodySchema = z
  .object({
    url: z.string().url("Alist 服务地址必须是有效的 URL"),
    mountPath: z.string().min(1, "挂载路径不能为空").default("/"),
    token: z.string().optional()
  })
  .strict();

export const alistListDirectoryBodySchema = z
  .object({
    url: z.string().url("Alist 服务地址必须是有效的 URL"),
    path: z.string().default("/"),
    token: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    perPage: z.coerce.number().int().min(1).max(200).default(100),
    refresh: z.boolean().default(false)
  })
  .strict();

export const alistGetFileBodySchema = z
  .object({
    url: z.string().url("Alist 服务地址必须是有效的 URL"),
    path: z.string().min(1),
    token: z.string().optional()
  })
  .strict();

export const alistStreamQuerySchema = z
  .object({
    url: z.string().url("目标音频直链必须是有效的 URL")
  })
  .strict();
