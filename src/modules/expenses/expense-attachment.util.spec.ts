import { computeExpenseAttachmentHash } from './expense-attachment.util';

describe('expense-attachment.util', () => {
  describe('computeExpenseAttachmentHash', () => {
    it('returns deterministic hash for same content', () => {
      const fileBuffer = Buffer.from('sample-proof-content');
      const hashA = computeExpenseAttachmentHash(fileBuffer);
      const hashB = computeExpenseAttachmentHash(
        Buffer.from('sample-proof-content'),
      );

      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns different hashes for different content', () => {
      const hashA = computeExpenseAttachmentHash(Buffer.from('proof-a'));
      const hashB = computeExpenseAttachmentHash(Buffer.from('proof-b'));

      expect(hashA).not.toBe(hashB);
    });
  });
});
