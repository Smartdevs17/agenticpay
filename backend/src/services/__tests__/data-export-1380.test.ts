import { beforeEach, describe, expect, it } from 'vitest';
import { DataExportService } from '../dataExport.js';
import { decrypt, isEncrypted } from '../../encryption/column-encryptor.js';

describe('GDPR export encryption (#1380)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.COLUMN_ENCRYPTION_MASTER_KEY = '11'.repeat(32);
  });

  it('stores completed export content as authenticated ciphertext', () => {
    const service = new DataExportService();
    const created = service.createExport({
      userId: 'tenant-1380', format: 'json', scope: ['full_account'], isGdprRequest: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(service.startExport(created.value.id).ok).toBe(true);
    const completed = service.completeExport(created.value.id, {
      downloadUrl: `/exports/${created.value.id}.json`, fileSizeBytes: 31, rowCount: 1,
      content: '{"email":"person@example.com"}',
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.encryptedContent).toBeDefined();
    expect(isEncrypted(completed.value.encryptedContent!)).toBe(true);
    expect(completed.value.encryptedContent).not.toContain('person@example.com');
    expect(decrypt(completed.value.encryptedContent!, 'tenant-1380')).toContain('person@example.com');
  });
});
