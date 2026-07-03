// Encodes a batch of PNG textures to WebP. Invoked once per run by the C# item-generator
// (AssetProcessor.ProcessMaterialTextures) with a JSONL manifest of jobs. sharp is pinned to an
// exact version so texture bytes — and therefore the content hashes embedded in CDN filenames —
// are reproducible across machines; the previous cwebp dependency came from apt and drifted.
// `exact` preserves RGB under fully-transparent pixels (read by shader logic) and must stay on.
// For near-lossless jobs (normal maps), `quality` is libwebp's near-lossless level, not lossy Q.
// For lossless jobs (data-selector textures: paint masks, AO), `quality` is VP8L's compression
// effort — bytes are bit-exact regardless. The flag is only forwarded when true so lossy and
// near-lossless outputs stay byte-identical to previous runs (their content hashes must not move).
import { readFile, mkdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import sharp from "sharp";

interface EncodeJob {
    src: string;
    dest: string;
    quality: number;
    nearLossless: boolean;
    lossless?: boolean;
}

const manifestPath = process.argv[2];
if (manifestPath === undefined) {
    console.error("usage: tsx encode-webp.ts <jobs.jsonl>");
    process.exit(1);
}

const jobs: EncodeJob[] = (await readFile(manifestPath, "utf-8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

let failed = 0;

async function encode({ src, dest, quality, nearLossless, lossless }: EncodeJob) {
    try {
        await mkdir(dirname(dest), { recursive: true });
        await sharp(src)
            .webp({ quality, nearLossless, ...(lossless ? { lossless: true } : {}), exact: true })
            .toFile(dest);
        console.log(`done ${dest}`);
    } catch (error) {
        failed += 1;
        console.error(`error ${src}: ${error instanceof Error ? error.message : error}`);
    }
}

const workers = Math.max(2, availableParallelism());
let next = 0;
await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
        while (next < jobs.length) {
            await encode(jobs[next++]!);
        }
    })
);

if (failed > 0) {
    console.error(`${failed} of ${jobs.length} encode jobs failed.`);
    process.exit(1);
}
