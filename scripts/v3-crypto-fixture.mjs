import { generateKeyPairSync, sign } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { canonicalPortable } from '../shared/v3-portable.mjs'
import { sealVault } from '../server/v3/vault-crypto.mjs'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const message = Buffer.from(
  canonicalPortable({
    purpose: 'today.mock.read-init.v1',
    issuer: 'fixture-crypto-only',
    operation: 'overview',
    nonce: 'fixture-only',
  }),
)
const rawKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(12)
const key = Buffer.alloc(32, 7),
  binding = { vaultId: 'fixture-crypto-only', epoch: 'fixture-one', revision: 1 },
  value = { fixtureOnly: true, text: '架空の暗号互換性' }
const sealed = sealVault(value, key, binding)
await writeFile(
  new URL(
    '../apps/ios/TodayNativeCore/Tests/TodayNativeCoreTests/Fixtures/gateway-crypto.json',
    import.meta.url,
  ),
  JSON.stringify(
    {
      fixtureOnly: true,
      message: message.toString('base64'),
      publicKey: rawKey.toString('base64'),
      signature: sign(null, message, privateKey).toString('base64'),
      aes: {
        key: key.toString('base64'),
        binding: Buffer.from(canonicalPortable(binding)).toString('base64'),
        plaintext: Buffer.from(JSON.stringify(value)).toString('base64'),
        ...sealed,
      },
    },
    null,
    2,
  ) + '\n',
)
key.fill(0)
