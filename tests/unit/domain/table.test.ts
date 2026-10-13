import { describe, expect, it } from 'vitest';
import { InvalidPlayerNameError, MAX_SEATS, Table, TableFullError, normalizePlayerName } from '@commander-brawl/domain';

describe('Table', () => {
  it('gives each new player the lowest free seat', () => {
    const table = new Table();
    expect(table.seat('a', 'Alice').seat).toBe(0);
    expect(table.seat('b', 'Bob').seat).toBe(1);
    table.unseat('a');
    expect(table.seat('c', 'Cleo').seat).toBe(0);
  });

  it('keeps the same seat when a seated player is seated again', () => {
    const table = new Table();
    table.seat('a', 'Alice');
    table.seat('b', 'Bob');
    expect(table.seat('b', 'Bob').seat).toBe(1);
    expect(table.all).toHaveLength(2);
  });

  it('refuses a fifth player', () => {
    const table = new Table();
    for (let i = 0; i < MAX_SEATS; i++) table.seat(`p${i}`, `Player ${i}`);
    expect(table.isFull).toBe(true);
    expect(() => table.seat('extra', 'Extra')).toThrow(TableFullError);
  });

  it('lists players in seat order', () => {
    const table = new Table();
    table.seat('a', 'Alice');
    table.seat('b', 'Bob');
    table.seat('c', 'Cleo');
    table.unseat('a');
    table.seat('d', 'Dana');
    expect(table.all.map((p) => p.name)).toEqual(['Dana', 'Bob', 'Cleo']);
  });
});

describe('normalizePlayerName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizePlayerName('  Robin   J  ')).toBe('Robin J');
  });

  it.each(['', '   ', 'x'.repeat(25)])('rejects %j', (name) => {
    expect(() => normalizePlayerName(name)).toThrow(InvalidPlayerNameError);
  });
});
