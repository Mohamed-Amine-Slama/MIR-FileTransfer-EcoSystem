import { describe, expect, it } from 'vitest';
import { sha256 } from './index';

describe('sha256', () => {
  it('matches the known digest of the empty input', () => {
    expect(sha256(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('changes when a single byte changes', () => {
    const a = sha256(Uint8Array.from([0x00, 0x01, 0x02]));
    const b = sha256(Uint8Array.from([0x00, 0x01, 0x03]));
    expect(a).not.toBe(b);
  });
});
