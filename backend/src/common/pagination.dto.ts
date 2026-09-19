import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { PageQuery } from '../contract/api.types';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** `?page=&limit=` for every list endpoint: page from 1 (default 1), limit default 20, max 100. */
export class PageQueryDto implements PageQuery {
  /** 1-based page number. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Items per page, 1–100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

export function pageWindow(q: PageQuery): { skip: number; take: number } {
  const page = q.page ?? 1;
  const take = q.limit ?? DEFAULT_PAGE_LIMIT;
  return { skip: (page - 1) * take, take };
}
