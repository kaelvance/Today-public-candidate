import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, gzip, constants } from 'node:zlib'

const brotli = promisify(brotliCompress)
const zip = promisify(gzip)

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) {
      await visit(file)
      continue
    }
    if (!/\.(?:html|js|css|svg|webmanifest)$/.test(entry.name)) continue
    const data = await readFile(file)
    await Promise.all([
      writeFile(
        `${file}.br`,
        await brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 7 } }),
      ),
      writeFile(`${file}.gz`, await zip(data, { level: 7 })),
    ])
  }
}

await visit(new URL('../dist/', import.meta.url).pathname)
