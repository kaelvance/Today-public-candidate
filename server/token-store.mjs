import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class EncryptedTokenStore {
  constructor(file, key) {
    if (!Buffer.isBuffer(key) || key.length !== 32)
      throw new Error('TODAY_TOKEN_KEY must decode to 32 bytes')
    this.file = file
    this.key = key
    this.chain = Promise.resolve()
  }

  async all() {
    try {
      const envelope = JSON.parse(await readFile(this.file, 'utf8'))
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(envelope.iv, 'base64url'),
      )
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64url')),
        decipher.final(),
      ])
      const records = JSON.parse(plain.toString('utf8'))
      if (!records || typeof records !== 'object' || Array.isArray(records))
        throw new Error('Invalid token store')
      return records
    } catch (error) {
      if (error?.code === 'ENOENT') return {}
      throw error
    }
  }

  async get(id) {
    return (await this.all())[id] ?? null
  }

  update(id, value) {
    this.chain = this.chain
      .catch(() => {})
      .then(async () => {
        const records = await this.all()
        if (value === null) delete records[id]
        else records[id] = value
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.key, iv)
        const data = Buffer.concat([cipher.update(JSON.stringify(records)), cipher.final()])
        const envelope = JSON.stringify({
          version: 1,
          iv: iv.toString('base64url'),
          tag: cipher.getAuthTag().toString('base64url'),
          data: data.toString('base64url'),
        })
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
        const temporary = `${this.file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        await writeFile(temporary, envelope, { mode: 0o600, flag: 'wx' })
        await rename(temporary, this.file)
      })
    return this.chain
  }
}
