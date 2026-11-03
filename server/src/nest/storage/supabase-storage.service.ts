import { readEnv } from '../../app-config';
import { withRequestContext } from '../database/request-context';
import { StorageAdminService } from './storage-admin.service';
import { StorageJobsService } from './storage-jobs.service';
import { MikroORM } from '@mikro-orm/core';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { STORAGE_CATEGORIES, storageConfigPutSchema, type StorageBackend } from '@trek/shared';

/** One-time operator rollout through the existing encrypted config and copy-before-flip migration. */
@Injectable()
export class SupabaseStorageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SupabaseStorageService.name);
  constructor(
    private readonly admin: StorageAdminService,
    private readonly jobs: StorageJobsService,
    private readonly orm: MikroORM,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.MANZIL_PROVISION_SUPABASE_STORAGE !== '1') return;
    await withRequestContext(this.orm, async () => {
      const project = readEnv().supabase.url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
      const region = process.env.SUPABASE_S3_REGION?.trim();
      const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID;
      const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
      const bucket = process.env.SUPABASE_S3_BUCKET?.trim();
      if (!project || !region || !accessKeyId || !secretAccessKey || bucket !== 'manzil-discover') {
        throw new Error(
          'Supabase private storage rollout requires the confirmed project, bucket and all S3 variables.',
        );
      }
      const candidate: StorageBackend = {
        name: 'supabase-private',
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
      const test = await this.admin.testBackend(candidate);
      if (!test.ok)
        throw new Error('Supabase private storage connection test failed. Existing storage has been preserved.');
      let state = await this.admin.state();
      if (!state.backends.some((backend) => backend.name === candidate.name)) {
        await this.admin.applyConfig(
          storageConfigPutSchema.parse({
            version: state.version,
            backends: [
              ...state.backends
                .filter((backend) => backend.source === 'settings')
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
      }
      for (const category of STORAGE_CATEGORIES.filter((value) => value !== 'backups')) {
        state = await this.admin.state();
        const source = state.categories[category].backend;
        if (source === candidate.name) continue;
        // A deliberate administrator routing choice is never replaced by rollout automation.
        if (!['uploads-local', 'place-photos-local'].includes(source)) continue;
        await this.admin.startMigration(category, candidate.name);
        for (;;) {
          const status = this.jobs.migrationStatuses().find((item) => item.category === category);
          if (!status || status.status === 'failed' || status.status === 'cancelled' || status.failed > 0) {
            throw new Error(
              `Supabase storage migration for ${category} did not finish. Inspect Storage settings before retrying.`,
            );
          }
          if (status.status === 'done') break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      this.logger.log(
        'Supabase private storage verified; uploads migrated using copy-before-flip. Backups remain on the persistent volume.',
      );
    });
  }
}
