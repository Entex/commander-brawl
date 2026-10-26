/**
 * Trusted Ed25519 release public keys, in PEM format. Add the publisher's public key here before shipping
 * signed updates. An empty list disables in-app installation; keys are never learned from a download.
 */
export const RELEASE_PUBLIC_KEYS: readonly string[] = [
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAVaeqh09WX8ZHYNkxjFei033J+9po4IsBIC9oJT9EkdQ=\n-----END PUBLIC KEY-----\n',
];
