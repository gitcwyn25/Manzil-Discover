import { readEnv } from '../../app-config';
import { withRequestContext } from '../database/request-context';
import { StorageAdminService } from './storage-admin.service';
import { StorageJobsService } from './storage-jobs.service';
import { StorageRegistryService } from './storage-registry.service';
import { MANZIL_UPLOAD_MAX_BYTES, MANZIL_USER_UPLOAD_CATEGORIES } from './storage.types';
import { MikroORM } from '@mikro-orm/core';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { storageConfigPutSchema, type StorageBackend, type StorageCategory } from '@trek/shared';

const BACKEND_NAME = 'supabase-private';
const PROJECT = 'wfabehnihelxemztmvca';

interface MigrationPlan {
  category: (typeof MANZIL_USER_UPLOAD_CATEGORIES)[number];
  source: string;
  prefix: string;
}

/** Operator-enabled rollout; network/copy work never owns application readiness. */
@Injectable()
export class SupabaseStorageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private stopped = false;
  private rollout: Promise<void> | undefined;
  private activeCategory: StorageCategory | undefined;

  constructor(
    private readonly admin: StorageAdminService,
    private readonly jobs: StorageJobsService,
    private readonly orm: MikroORM,
    private readonly registry: StorageRegistryService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.MANZIL_PROVISION_SUPABASE_STORAGE !== '1' || this.rollout) return;
    this.rollout = this.afterReady().catch(() => {
      // Provider exceptions can contain request details. Keep credentials and
      // object paths out of this operational summary.
      this.logger.error(
        'Supabase upload rollout stopped. Inspect Storage settings; the application remains available.',
      );
    });
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.activeCategory) this.jobs.cancelMigration(this.activeCategory);
  }

  private async afterReady(): Promise<void> {
    const port = readEnv().app.port;
    for (let attempt = 0; attempt < 120 && !this.stopped; attempt++) {
      let ready = false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          headers: { 'X-Forwarded-Proto': 'https' },
          redirect: 'error',
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok && ((await response.json()) as { status?: string }).status === 'ok';
      } catch {
        // The listener may not exist yet. Storage failures are handled outside
        // this loop, so they cannot repeatedly rewrite configuration.
      }
      if (ready) {
        if (!this.stopped) await withRequestContext(this.orm, () => this.configureAndMigrate());
        return;
      }
      await this.pause(500);
    }
    if (!this.stopped) this.logger.warn('Supabase upload rollout skipped: local health did not become ready.');
  }

  private candidate(): Extract<StorageBackend, { type: 's3' }> {
    const project = readEnv().supabase.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
    const region = process.env.SUPABASE_S3_REGION?.trim();
    const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
    const bucket = process.env.SUPABASE_S3_BUCKET?.trim();
    if (project !== PROJECT || !region || !accessKeyId || !secretAccessKey || bucket !== 'manzil-discover') {
      throw new Error('Confirmed Supabase private storage variables are incomplete.');
    }
    return {
      name: BACKEND_NAME,
      type: 's3',
      options: {
        endpoint: `https://${project}.storage.supabase.co/storage/v1/s3`,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        keyPrefix: '',
        retries: 1,
        timeoutMs: 30000,
      },
    };
  }

  /** @txIndependent Configuration and each copy-before-flip migration are complete independently; network I/O separates them. */
  private async configureAndMigrate(): Promise<void> {
    const candidate = this.candidate();
    const test = await this.admin.testBackend(candidate);
    if (!test.ok || this.stopped) {
      this.logger.warn('Supabase upload rollout skipped: private storage probe did not complete successfully.');
      return;
    }

    const state = await this.admin.state();
    const existing = state.backends.find((backend) => backend.name === BACKEND_NAME);
    if (
      existing &&
      (existing.type !== 's3' ||
        existing.options.endpoint !== candidate.options.endpoint ||
        existing.options.bucket !== candidate.options.bucket ||
        existing.options.keyPrefix !== '')
    ) {
      this.logger.warn(
        'Supabase upload rollout skipped: the target name belongs to a different storage configuration.',
      );
      return;
    }

    // Preflight every eligible source BEFORE the first category can flip.
    // Explicit administrator routes, including an explicit local route, stay put.
    const plan: MigrationPlan[] = [];
    for (const category of MANZIL_USER_UPLOAD_CATEGORIES) {
      if (this.stopped) return;
      const route = state.categories[category];
      if (route.backend === BACKEND_NAME || route.source !== 'default' || route.backend !== 'uploads-local') continue;
      const source = this.registry.resolve(category);
      let oversized = 0;
      for await (const object of source.driver.list(source.keyPrefix)) {
        if (this.stopped) return;
        if (!Number.isFinite(object.size) || object.size < 0 || object.size > MANZIL_UPLOAD_MAX_BYTES) oversized++;
      }
      if (oversized) {
        this.logger.warn(
          `Supabase ${category} migration skipped: ${oversized} object(s) exceed the 4 MB policy or have unknown size. Local storage retained.`,
        );
        continue;
      }
      plan.push({ category, source: source.backendName, prefix: source.keyPrefix });
    }
    if (this.stopped) return;

    // A verified credential rotation updates only this fixed project/bucket.
    // applyConfig uses the version we read, refusing a concurrent admin save.
    await this.admin.applyConfig(
      storageConfigPutSchema.parse({
        version: state.version,
        backends: [
          ...state.backends
            .filter((backend) => backend.source === 'settings' && backend.name !== BACKEND_NAME)
            .map(({ name, type, options }) => ({ name, type, options })),
          candidate,
        ],
        categories: Object.fromEntries(
          Object.entries(state.categories)
            .filter(([, route]) => route.source === 'settings')
            .map(([category, route]) => [category, route.backend]),
        ),
      }),
    );

    let migrated = 0;
    for (const item of plan) {
      if (this.stopped) return;
      const current = this.registry.resolve(item.category);
      const route = this.registry.snapshot().categories[item.category];
      if (route.source !== 'default' || current.backendName !== item.source || current.keyPrefix !== item.prefix)
        continue;
      this.activeCategory = item.category;
      try {
        await this.admin.startMigration(item.category, BACKEND_NAME);
        for (;;) {
          if (this.stopped) {
            this.jobs.cancelMigration(item.category);
            return;
          }
          const status = this.jobs.migrationStatuses().find((value) => value.category === item.category);
          if (!status || status.status === 'failed' || status.status === 'cancelled' || status.failed > 0) {
            this.logger.warn(
              `Supabase ${item.category} migration did not complete. Inspect Storage settings; source files are preserved.`,
            );
            return;
          }
          if (status.status === 'done') {
            migrated++;
            break;
          }
          await this.pause(100);
        }
      } finally {
        this.activeCategory = undefined;
      }
    }
    this.logger.log(
      `Supabase private storage verified; ${migrated} user-upload category migration(s) completed. Caches and backups remain local.`,
    );
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
