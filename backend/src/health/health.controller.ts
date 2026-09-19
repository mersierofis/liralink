import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AnchorProvider, GetHealthResponse, SettlementMode } from '../contract/api.types';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { HorizonListenerService } from '../stellar/horizon-listener.service';

const HORIZON_TIMEOUT_MS = 2_000;

class HealthDto implements GetHealthResponse {
  ok!: boolean;
  horizon!: 'up' | 'down';
  anchor!: AnchorProvider;
  listener!: 'running' | 'stopped';
  listenerCursor!: string | null;
  platformAccount!: string;
  settlementMode!: SettlementMode;
}

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly listener: HorizonListenerService,
  ) {}

  /** GET /health → 200 */
  @Get()
  @ApiOkResponse({ type: HealthDto })
  async get(): Promise<GetHealthResponse> {
    const [ok, horizon] = await Promise.all([this.databaseUp(), this.horizonUp()]);
    const listenerCursor = this.listener.cursor ?? (await this.prisma.listenerCursor.findUnique({
      where: { id: 'horizon-payments' },
    }).then((r) => r?.cursor ?? null));
    return {
      ok,
      horizon: horizon ? 'up' : 'down',
      anchor: this.config.anchorProvider,
      listener: this.listener.running ? 'running' : 'stopped',
      listenerCursor,
      platformAccount: this.config.platformAccount,
      settlementMode: this.config.settlementMode,
    };
  }

  private async databaseUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async horizonUp(): Promise<boolean> {
    try {
      const res = await fetch(this.config.env.HORIZON_URL, { signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
