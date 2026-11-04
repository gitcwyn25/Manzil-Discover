import { StorageAdminService } from '../../../src/nest/storage/storage-admin.service';
import { StorageJobsService } from '../../../src/nest/storage/storage-jobs.service';
import { StorageRegistryService } from '../../../src/nest/storage/storage-registry.service';
import { SupabaseStorageService } from '../../../src/nest/storage/supabase-storage.service';
import { MikroORM } from '@mikro-orm/core';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { STORAGE_CATEGORIES, type StorageCategory } from '@trek/shared';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const modules: TestingModule[] = [];
const URL = 'https://wfabehnihelxemztmvca.supabase.co';
type Route = { backend: string; source: 'default' | 'settings' };

beforeEach(() => {
  vi.stubEnv('MANZIL_PROVISION_SUPABASE_STORAGE', '1');
  vi.stubEnv('SUPABASE_URL', URL);
  vi.stubEnv('SUPABASE_S3_REGION', 'ap-southeast-1');
  vi.stubEnv('SUPABASE_S3_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('SUPABASE_S3_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('SUPABASE_S3_BUCKET', 'manzil-discover');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok"}')));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  for (const module of modules.splice(0)) await module.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fixture(options: { oversized?: boolean; custom?: boolean; probeOk?: boolean } = {}) {
  const categories = Object.fromEntries(
    STORAGE_CATEGORIES.map((category) => [
      category,
      {
        backend: category === 'backups' ? 'backups-local' : 'uploads-local',
        source: 'default',
      },
    ]),
  ) as Record<StorageCategory, Route>;
  if (options.custom) categories.places = { backend: 'operator-local', source: 'settings' };
  const backends = options.custom
    ? [{ name: 'operator-local', type: 'local', source: 'settings', options: { root: '/operator/files' } }]
    : [];
  const state = { categories, backends, version: 7 };
  const events: string[] = [];
  const statuses = new Map<StorageCategory, { category: StorageCategory; status: string; failed: number }>();
  const admin = {
    testBackend: vi.fn().mockResolvedValue({ ok: options.probeOk !== false }),
    state: vi.fn().mockImplementation(async () => structuredClone(state)),
    applyConfig: vi.fn().mockResolvedValue(undefined),
    startMigration: vi.fn().mockImplementation(async (category: StorageCategory) => {
      events.push(`migrate:${category}`);
      categories[category] = { backend: 'supabase-private', source: 'settings' };
      statuses.set(category, { category, status: 'done', failed: 0 });
    }),
  };
  const jobs = { migrationStatuses: () => [...statuses.values()], cancelMigration: vi.fn() };
  const registry = {
    snapshot: () => ({ categories }),
    resolve: vi.fn().mockImplementation((category: StorageCategory) => ({
      backendName: categories[category].backend,
      keyPrefix: `${category}/`,
      driver: {
        async *list() {
          events.push(`preflight:${category}`);
          yield {
            key: `${category}/private-name.bin`,
            size: category === 'files' && options.oversized ? 4194305 : 4194304,
          };
        },
      },
    })),
  };
  // RequestContext only needs a fork to scope these controlled collaborators;
  // no repository or database is queried by this unit boundary.
  const em = {
    name: 'default',
    fork() {
      return this;
    },
  };
  const module = await Test.createTestingModule({
    providers: [
      SupabaseStorageService,
      { provide: StorageAdminService, useValue: admin },
      { provide: StorageJobsService, useValue: jobs },
      { provide: StorageRegistryService, useValue: registry },
      { provide: MikroORM, useValue: { em } },
    ],
  }).compile();
  modules.push(module);
  return { service: module.get(SupabaseStorageService), admin, jobs, registry, categories, events, statuses };
}

describe('Supabase storage rollout readiness', () => {
  it('returns before health is ready and does not provision a disabled rollout', async () => {
    let answer!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { service, admin } = await fixture();
    expect(service.onApplicationBootstrap()).toBeUndefined();
    expect(admin.testBackend).not.toHaveBeenCalled();
    service.onModuleDestroy();
    answer(new Response('{"status":"ok"}'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admin.testBackend).not.toHaveBeenCalled();
    vi.stubEnv('MANZIL_PROVISION_SUPABASE_STORAGE', '0');
    const disabled = await fixture();
    disabled.service.onApplicationBootstrap();
    expect(disabled.admin.testBackend).not.toHaveBeenCalled();
  });

  it('preflights all eligible user categories before any flip, leaving caches and backups alone', async () => {
    const { service, admin, events, registry } = await fixture();
    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(admin.startMigration).toHaveBeenCalledTimes(5));
    const firstFlip = events.findIndex((event) => event.startsWith('migrate:'));
    expect(events.slice(0, firstFlip)).toEqual(
      ['files', 'journey', 'covers', 'avatars', 'places'].map((category) => `preflight:${category}`),
    );
    expect(registry.resolve.mock.calls.map(([category]) => category)).not.toContain('photos-google');
    expect(registry.resolve.mock.calls.map(([category]) => category)).not.toContain('backups');
    expect(admin.applyConfig.mock.calls[0][0]).toMatchObject({ version: 7, categories: {} });
  });

  it('skips an oversized category and explicit operator routes without exposing object names', async () => {
    const { service, admin } = await fixture({ oversized: true, custom: true });
    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(admin.startMigration).toHaveBeenCalledTimes(3));
    expect(admin.startMigration.mock.calls.map(([category]) => category)).toEqual(['journey', 'covers', 'avatars']);
    const saved = admin.applyConfig.mock.calls[0][0];
    expect(saved.categories).toEqual({ places: 'operator-local' });
    expect(saved.backends).toContainEqual({
      name: 'operator-local',
      type: 'local',
      options: { root: '/operator/files' },
    });
    expect(vi.mocked(Logger.prototype.warn).mock.calls.flat().join(' ')).not.toContain('private-name');
  });

  it('does not apply configuration after a failed probe', async () => {
    const { service, admin } = await fixture({ probeOk: false });
    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(Logger.prototype.warn).toHaveBeenCalled());
    expect(admin.applyConfig).not.toHaveBeenCalled();
    expect(admin.startMigration).not.toHaveBeenCalled();
  });

  it('does not retry or leak a failed config write into readiness', async () => {
    const { service, admin } = await fixture();
    admin.applyConfig.mockRejectedValue(new Error('test-secret private-name.bin'));
    expect(service.onApplicationBootstrap()).toBeUndefined();
    await vi.waitFor(() => expect(Logger.prototype.error).toHaveBeenCalled());
    expect(admin.applyConfig).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Logger.prototype.error).mock.calls.flat().join(' ')).not.toContain('test-secret');
    expect(admin.startMigration).not.toHaveBeenCalled();
  });

  it('cancels only its own migration when the application shuts down', async () => {
    const { service, admin, jobs, statuses } = await fixture();
    admin.startMigration.mockImplementation(async (category: StorageCategory) => {
      statuses.set(category, { category, status: 'running', failed: 0 });
    });
    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(admin.startMigration).toHaveBeenCalledTimes(1));
    service.onModuleDestroy();
    expect(jobs.cancelMigration).toHaveBeenCalledWith('files');
    expect(admin.startMigration).toHaveBeenCalledTimes(1);
  });
});
