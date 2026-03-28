import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private connected = false;
  private warnedUnavailable = false;
  private readonly fallbackStore = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();

  constructor(private configService: ConfigService) {
    const redisEnabled = this.configService.get<boolean>('redis.enabled');
    const redisEnvironment = this.configService.get<string>('redis.environment');
    
    if (!redisEnabled) {
      this.logger.log('Redis disabled by configuration; using in-memory fallback');
      return;
    }

    this.logger.debug(`Initializing Redis for ${redisEnvironment} environment`);

    try {
      const retryStrategy = (times: number) => {
        if (times > 3) {
          this.warnUnavailable('Redis unavailable after 3 retries');
          return null as unknown as number; // stop retrying
        }
        return Math.min(times * 200, 2000);
      };

      const baseOptions = {
        retryStrategy,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
      };

      const redisUrl = this.configService.get<string>('redis.url');
      if (redisUrl) {
        // For rediss:// URLs (TLS), allow self-signed certificates
        const urlOptions = redisUrl.startsWith('rediss://')
          ? { tls: { rejectUnauthorized: false } }
          : {};
        this.client = new Redis(redisUrl, { ...baseOptions, ...urlOptions });
        this.logger.debug('Using REDIS_URL (Heroku add-on or managed instance)');
      } else {
        const tlsEnabled = this.configService.get<boolean>('redis.tlsEnabled');
        this.client = new Redis({
          host: this.configService.get<string>('redis.host'),
          port: this.configService.get<number>('redis.port'),
          password: this.configService.get<string>('redis.password'),
          ...(tlsEnabled ? { tls: { rejectUnauthorized: false } } : {}),
          ...baseOptions,
        });
        this.logger.debug(`Using host/port config (${redisEnvironment})`);
      }

      this.client.on('connect', () => {
        this.connected = true;
        this.logger.log('Redis connected');
      });

      this.client.on('error', (err) => {
        this.connected = false;
        this.warnUnavailable(`Redis error: ${err.message}`);
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      // Attempt connection but do not crash if it fails
      this.client.connect().catch((err) => {
        this.warnUnavailable(`Redis not available: ${err.message}`);
        this.client = null;
      });
    } catch (err: any) {
      this.warnUnavailable(`Redis init failed: ${err.message}`);
      this.client = null;
    }
  }

  private warnUnavailable(message: string): void {
    if (this.warnedUnavailable) {
      return;
    }
    this.warnedUnavailable = true;
    this.logger.warn(`${message} — running without cache`);
  }

  isAvailable(): boolean {
    // Redis is preferred; in-memory fallback keeps critical flows running
    // (OTP, token cache lookups) when Redis is temporarily unavailable.
    return true;
  }

  getClient(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        // fall through to in-memory fallback
      }
    }

    const entry = this.fallbackStore.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.fallbackStore.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.connected && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch {
        // fall through to in-memory fallback
      }
    }

    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.fallbackStore.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.fallbackStore.delete(key);

    if (this.connected && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // Silently ignore — Redis is optional
      }
    }
  }

  async getTtlSeconds(key: string): Promise<number> {
    if (this.connected && this.client) {
      try {
        const ttl = await this.client.ttl(key);
        return ttl > 0 ? ttl : 0;
      } catch {
        // fall through to in-memory fallback
      }
    }

    const entry = this.fallbackStore.get(key);
    if (!entry || entry.expiresAt === null) {
      return 0;
    }

    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.fallbackStore.delete(key);
      return 0;
    }

    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  async keys(pattern: string): Promise<string[]> {
    if (this.connected && this.client) {
      try {
        return await this.client.keys(pattern);
      } catch {
        // fall through to in-memory fallback
      }
    }

    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
    const now = Date.now();
    const matches: string[] = [];

    for (const [key, entry] of this.fallbackStore.entries()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.fallbackStore.delete(key);
        continue;
      }
      if (regex.test(key)) {
        matches.push(key);
      }
    }

    return matches;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.log('Redis disconnected');
      } catch {
        // Already disconnected
      }
    }
  }
}
