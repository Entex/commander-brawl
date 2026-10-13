import {
  parseClientMessage,
  parseDesktopToPhone,
  parsePhoneToDesktop,
  parseServerMessage,
} from '@commander-brawl/infrastructure/protocol';
import { describe, expect, it } from 'vitest';

describe('table protocol', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"t":"hello","v":1,"secret":"s","name":"Robin"}')).toEqual({
      t: 'hello',
      v: 1,
      secret: 's',
      name: 'Robin',
      resumeToken: undefined,
    });
    expect(parseServerMessage('{"t":"member-joined","member":{"id":"a","name":"A","seat":3}}')).toEqual({
      t: 'member-joined',
      member: { id: 'a', name: 'A', seat: 3 },
    });
  });

  it.each([
    'not json',
    '[]',
    '{"t":"unknown"}',
    '{"t":"hello","v":1,"secret":"","name":"x"}',
    '{"t":"signal","to":"a"}',
  ])('rejects client message %s', (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it.each([
    '{"t":"member-joined","member":{"id":"a","name":"A","seat":4}}',
    '{"t":"welcome","selfId":"a","resumeToken":"r","members":[{"id":"a"}]}',
    '{"t":"rejected","reason":"because"}',
  ])('rejects server message %s', (raw) => {
    expect(parseServerMessage(raw)).toBeNull();
  });
});

describe('game messages', () => {
  const entry = {
    seq: 0,
    id: 'e1',
    at: 1_700_000_000_000,
    by: { id: 'a', name: 'Alice', seat: 0 },
    event: { type: 'life-changed', seat: 1, amount: -3 },
  };

  it('reads game events and sync requests from players', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'event', id: 'e1', event: { anything: true } }))).toEqual({
      t: 'event',
      id: 'e1',
      event: { anything: true },
    });
    expect(parseClientMessage('{"t":"sync","logId":null,"from":0}')).toEqual({ t: 'sync', logId: null, from: 0 });
    expect(parseClientMessage('{"t":"sync","logId":"x","from":-1}')).toBeNull();
  });

  it('reads log entries from the host', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'events', logId: 'l', from: 0, events: [entry] }))).toEqual({
      t: 'events',
      logId: 'l',
      from: 0,
      events: [entry],
    });
  });

  it('rejects a batch with an invalid entry', () => {
    const broken = { ...entry, event: { type: 'life-changed', seat: 1, amount: 0 } };
    expect(
      parseServerMessage(JSON.stringify({ t: 'events', logId: 'l', from: 0, events: [entry, broken] })),
    ).toBeNull();
  });
});

describe('phone protocol', () => {
  it('accepts offers and candidates', () => {
    expect(parsePhoneToDesktop('{"t":"offer","session":2,"sdp":"v=0"}')).toEqual({
      t: 'offer',
      session: 2,
      sdp: 'v=0',
    });
    expect(
      parseDesktopToPhone('{"t":"candidate","session":1,"candidate":{"candidate":"c","sdpMid":"0","sdpMLineIndex":0}}'),
    ).toEqual({ t: 'candidate', session: 1, candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } });
  });

  it.each([
    '{"t":"offer","session":-1,"sdp":"v=0"}',
    '{"t":"offer","session":1}',
    '{"t":"answer","session":1,"sdp":"x"}',
  ])('rejects phone message %s', (raw) => {
    expect(parsePhoneToDesktop(raw)).toBeNull();
  });
});
