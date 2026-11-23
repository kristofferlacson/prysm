/**
 * Downloads the background-removal models into public/models so the editor can serve them itself.
 * Nothing is fetched from a third party at runtime and images never leave the browser.
 *
 *   npm run setup:ai            Fast + Balanced background removal, the object finder and the upscaler (about 68 MB)
 *   npm run setup:ai -- --all   also Detailed / IS-Net (about 179 MB more)
 *
 * Models: U²-Net family and IS-Net by Xuebin Qin et al., Apache-2.0, as ONNX exports published
 * with the rembg project (https://github.com/danielgatis/rembg). The object finder ("click an
 * object" in the background-removal dialog) is SlimSAM-77 by Zigeng Chen et al., Apache-2.0, a
 * compressed Segment Anything model, as the 8-bit ONNX export published by Xenova on Hugging Face.
 * Every file is checked against a pinned SHA-256 before it is kept.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';
// Upscaling: the official Real-ESRGAN "general x4 v3" weights (Xintao Wang et al., BSD-3-Clause; the
// licence text is kept next to the model as LICENSE-Real-ESRGAN.txt), exported to ONNX unchanged.
// The URL is pinned to one commit and the file to its SHA-256.
const UPSCALER = 'https://huggingface.co/vlad-grig/realesr-general-x4v3-onnx/resolve/0e95d93e454cf6b5de9bdf5a1c9e7ec340d38231/onnx/model.onnx';
// The object finder: two files that work as a pair, pinned to one commit.
const SLIMSAM = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/';
const MODELS = [
  { file: 'u2netp.onnx', sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8', optional: false },
  { file: 'silueta.onnx', sha256: '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb', optional: false },
  { file: 'realesr-general-x4v3.onnx', url: UPSCALER, sha256: '7b10e80021ec3e0ff35017ae5022791879d93a799b2e201e1010a37510202266', optional: false },
  { file: 'slimsam-encoder.onnx', url: SLIMSAM + 'vision_encoder_quantized.onnx', sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971', optional: false },
  { file: 'slimsam-decoder.onnx', url: SLIMSAM + 'prompt_encoder_mask_decoder_quantized.onnx', sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2', optional: false },
  { file: 'isnet-general-use.onnx', sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a', optional: true },
];

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
mkdirSync(dir, { recursive: true });
const all = process.argv.includes('--all');
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

let failed = false;
for (const model of MODELS) {
  if (model.optional && !all) continue;
  const target = join(dir, model.file);
  if (existsSync(target) && sha(readFileSync(target)) === model.sha256) {
    console.log(`ok       ${model.file}`);
    continue;
  }
  process.stdout.write(`fetching ${model.file} … `);
  try {
    const response = await fetch(model.url ?? BASE + model.file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (sha(buffer) !== model.sha256) throw new Error('checksum mismatch, file discarded');
    writeFileSync(`${target}.part`, buffer);
    renameSync(`${target}.part`, target);
    console.log(`${(buffer.length / 1048576).toFixed(1)} MB`);
  } catch (err) {
    rmSync(`${target}.part`, { force: true });
    console.log(`failed (${err.message})`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
