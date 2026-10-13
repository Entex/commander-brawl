import { NatPmpError, natPmpExternalAddress, natPmpMapTcp } from '@commander-brawl/infrastructure/node';
import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** A home router answering NAT-PMP, which keeps the ports it forwards. */
async function fakeRouter(options: { ignoreFirst?: number; refuse?: number; taken?: number[] } = {}) {
  const mappings = new Map<number, number>();
  let ignore = options.ignoreFirst ?? 0;
  let questions = 0;
  const socket = createSocket('udp4');
  socket.on('message', (message, from) => {
    questions++;
    if (ignore-- > 0) return;
    const opcode = message[1]!;
    const answer = Buffer.alloc(opcode === 0 ? 12 : 16);
    answer[1] = opcode + 128;
    answer.writeUInt16BE(options.refuse ?? 0, 2);
    if (opcode === 0) {
      Buffer.from([203, 0, 113, 9]).copy(answer, 8);
    } else {
      const internal = message.readUInt16BE(4);
      const lease = message.readUInt32BE(8);
      let external = message.readUInt16BE(6);
      if (lease === 0) mappings.delete(internal);
      else {
        while (options.taken?.includes(external)) external++;
        mappings.set(internal, external);
      }
      answer.writeUInt16BE(internal, 8);
      answer.writeUInt16BE(lease === 0 ? 0 : external, 10);
      answer.writeUInt32BE(lease, 12);
    }
    socket.send(answer, from.port, from.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  closing.push(() => socket.close());
  return {
    router: { address: '127.0.0.1', port: socket.address().port, from: '127.0.0.1' },
    mappings,
    questions: () => questions,
  };
}

describe('forwarding a port on the router (NAT-PMP)', () => {
  it('says the internet address, forwards the port, and removes the forward again', async () => {
    const { router, mappings } = await fakeRouter();
    expect(await natPmpExternalAddress(router)).toBe('203.0.113.9');
    expect(await natPmpMapTcp(router, 47801, 3600)).toEqual({ externalPort: 47801, leaseSeconds: 3600 });
    expect(mappings.get(47801)).toBe(47801);
    await natPmpMapTcp(router, 47801, 0);
    expect(mappings.size).toBe(0);
  });

  it('asks again when the first question gets no answer', async () => {
    const { router, questions } = await fakeRouter({ ignoreFirst: 1 });
    expect(await natPmpExternalAddress(router)).toBe('203.0.113.9');
    expect(questions()).toBe(2);
  });

  it('says which port the router opened when this one is taken', async () => {
    const { router } = await fakeRouter({ taken: [47801] });
    expect((await natPmpMapTcp(router, 47801, 3600)).externalPort).toBe(47802);
  });

  it("says why when the router refuses, and when it doesn't answer", async () => {
    const { router } = await fakeRouter({ refuse: 2 });
    const refusal = natPmpMapTcp(router, 47801, 3600);
    await expect(refusal).rejects.toBeInstanceOf(NatPmpError);
    await expect(refusal).rejects.toMatchObject({ code: 2, message: expect.stringContaining("isn't allowed") });

    const silent = await fakeRouter({ ignoreFirst: Infinity });
    await expect(natPmpExternalAddress(silent.router, 600)).rejects.toThrow("didn't answer");
  });
});
