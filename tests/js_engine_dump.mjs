// Runs the TypeScript in-browser engine (bundled by esbuild) over every dataset patient and prints JSON.
// Used by tests/test_parity.py.  Usage: node tests/js_engine_dump.mjs <engine.mjs> <app_data.json>
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const [enginePath, dataPath] = process.argv.slice(2)
const { predictLocal } = await import(pathToFileURL(enginePath).href)
const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
const out = d.patients.map((p) => predictLocal(d.bundle, p.inputs))
process.stdout.write(JSON.stringify(out))
