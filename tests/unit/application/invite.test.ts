import { InvalidInviteError, decodeInvite, encodeInvite, type Invite } from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';

const invite: Invite = {
  hosts: ['203.0.113.7', '2001:db8::1', '192.168.1.20'],
  port: 47801,
  secret: 'Zm9vYmFyYmF6cXV4cXV1eA',
  fingerprint: 'AB'.repeat(32),
};

describe('invite codes', () => {
  it('round-trips', () => {
    expect(decodeInvite(encodeInvite(invite))).toEqual(invite);
  });

  it('tolerates whitespace and line breaks from chat apps', () => {
    const code = encodeInvite(invite);
    const mangled = `  ${code.slice(0, 20)}\n${code.slice(20, 40)} ${code.slice(40)}  `;
    expect(decodeInvite(mangled)).toEqual(invite);
  });

  it.each([
    ['empty', ''],
    ['wrong prefix', 'XX1-abc'],
    ['not base64', 'CB1-!!!!'],
    ['not json', `CB1-${encodeInvite(invite).slice(4, 10)}`],
  ])('rejects %s', (_case, code) => {
    expect(() => decodeInvite(code)).toThrow(InvalidInviteError);
  });

  it.each([
    ['no hosts', { ...invite, hosts: [] }],
    ['bad port', { ...invite, port: 70_000 }],
    ['short secret', { ...invite, secret: 'abc' }],
    ['bad fingerprint', { ...invite, fingerprint: 'not-hex' }],
  ])('rejects an invite with %s', (_case, broken) => {
    expect(() => decodeInvite(encodeInvite(broken))).toThrow(InvalidInviteError);
  });
});
