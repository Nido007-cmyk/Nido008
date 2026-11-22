/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La batería hostil de la puerta de activos de E9 (paso 0):
 * downloadAsset y verifiedAssetDir contra las cuatro clases de
 * §4.7 de ACTIVOS-VOZ-CARGA y las enmiendas VA de la apertura,
 * con paquetes .tar.bz2 diminutos generados para esta batería
 * (registros del paso: gen-fixtures.py). Cada paquete espeja la
 * forma real medida de los de sherpa-onnx: un directorio raíz
 * con el nombre del propio fichero y los ficheros del manifiesto
 * bajo él. La red está apuntalada en todos los casos: ningún
 * caso toca la red de verdad, y las redirecciones se cobran
 * contra la forma medida de GitHub Releases.
 */

import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetEntry, AssetFile } from "./assetCatalog.js";
import { downloadAsset } from "./download.js";
import { censusAssets } from "./library.js";
import { LoadRefusal, verifiedAssetDir } from "./loadPath.js";

interface FxBlob { bytes: number; sha256: string; b64: string }
const FX: Record<string, FxBlob> = {
  good: { bytes: 394, sha256: "ffb1aae143fcd997fc5b844aafc9de27ddf6ffac52cceb87f5ebb528ed432ede", b64: "QlpoOTFBWSZTWZnPGuAAAW5/kf//////////yjUIAH5v32AAgABACAgwATlaURU00GhoNAGmTI0GQAAAaZDRkBiAADU0go9PUj0TTBMTAmgwAAAABNGTEwGgJJSZTamEaep6CPSaA0aAAAZAaaAA00PUB6n1Hb2Nk3mkGDncEKAv0gTjJAbfDvtwRhZU2AClals4GAE1CRhuAQy3Ci1JkU36ln3i6BxJA1PGrY+RLmHTZ0+gehRpU6lWtXsHAC/DoI0ahcu3r+DDix5MuZHwl3ACBABIgHLnG9Lh1WOtqS2gFUBgEdp3eDqAuMrfNbZ8tMkshyIlCOdNQyYvGVZ376tw6wQZQJHR3rJ48rrNZ+y6uvTeX7eoLyu06vo9VnQXXQyr0YwVwsA5YRPde7M4HU6GePI+EvtDFQBEbTk/KvQzkPIaYgRMnj86GUgRJBRkJqyVQ1A6AEwFzAGExho0AcAMuhgSITZJcBdiGYLdUJYoVwETKESJ8gRBQhrRJAf4u5IpwoSEznjXAA==" },
  good_long: { bytes: 490, sha256: "e45dd76f476f5764c14bdb569058406c1dbf16420215a0f48436d98a7ac514bf", b64: "QlpoOTFBWSZTWXTsYjAAAiH/lf//////////yjUIAH/v32AAgAABACAECDABmRrAJJRGo0aDQGmgbUMjT1GgA0ND0TT0QA2oBoAIqekb0UaAAAAAAAAAAAAAAAJIok8p4ptEeQmgEZGQxGRgNE0aMCBk0MNNTT9Uv93Frfn2rk3HqDSFH8qYRAxMAk7ABs3t2R94vUMoXBQXN/CZnFOiQSRS6FajdW2LjJY8d292dmXxjpIGx57+dn6FCjo6VLTg1NWnra+xs7VMXuLcoojbv9WzWZxyQF1U4OHiq8fJyw1q9yxMFM9BxKGuYYnbX5W55V69N20yloEzJMdbTgqCEjtN3u8I3xCwGVhopShYOyJ1xRWbt60NJEwAcUAHCsSgmEhTxKmSHoABDAREcYoCgYdGpxrv7Cfmrl81uzhE1o52RlW5Lr0t+fiPeLCoedwYIBikKAkoAkCY7StClXvxRrSkn9AqxEDCb1EQEpusB4GBJ1lAIv4rtgGuDSvYSAkIiFnx8BWAigYT2Bp0CJ6FJKgBrNZoIQERNAOAEMFVFegqaWiObDfEycWlL/Cd4LhjIEYVHusW88r2hWhZDFlZCTS6F2BUip8SbDGFG9U0M4tEBEtktpV6hXRTWjGygA/4u5IpwoSDp2MRgA==" },
  hostile_absolute: { bytes: 414, sha256: "40034f78ab5515fd078de735f7bb5ee843b440fbb9708496f84aed95b0ac1f0b", b64: "QlpoOTFBWSZTWVuGDb4AAZF/lP//////////yjUIAH5v32AAgAABCAgwAVlKBE1EAaABoxAaNGgAAAAAA0BoAcDRoxBo0yYQYgMRiaNGjQBppoAAAAkihCejJpqeppqNqYgyYIaNNDNAmHqQbUwA0TaaYv/38Ws/1Ww1QZDcE7iQxjAJOwgNdr2xee9gRAFecQ1vbqs6JURiSMdxFFZzIa2yWTWubXX23aR0iAAmwYUOI6ixkY8hKTKTlzJs6fQo0nBAU4HiQoKtavYs2rdy7ev4Fd/AFpg3rQPTuxVWo+TeUL/xskNcSXoQwgXIX+jmiEj9MqeH+8bxreZQQuzM0Tu8PFUCIcKklP5pq8DxqwC4CyjGLJZq2HbcO4f0A5UeOZuTkeagotQMcl8xICPVUBAF6QAmiDSRJ74qvJAEKhDTIkYEvFDFwBHe1hTyxxdlEqMNZmB5ECJCYbGs14UCL9EuJp46lecJQbCWUCNbDNMFtEfkhq9z2UQzImwntFHisQZQZwCI7RdRJiRKXQtZBPlCA8xdyRThQkFuGDb4" },
  hostile_dotdot: { bytes: 413, sha256: "dbcafd64ef74d125384bd1d99363d1c65d4acc5c0c26bf0843b1fd54261d0f06", b64: "QlpoOTFBWSZTWTyt5KkAAZD/lP//////////yjUKAH5v32AAgAABCAgwAVlKBESaAaABoMgaNDQAAAAADRkD1ADmTTQyABiMgyAGmCBiAaNNABkDQAJJIQxTaaaJkj1MAAIZPU9TEwE03qBPSMAnkNNMPpf5LbvuttqAyG45nCQxCAk5hAXG3Nv8ua8jdCOYQ1jeos5EiIhJFZwivScYrWGSs0sbd8PL5TjkhAAzT4cSK6jR0JElGVLmJTZ0+hRpU3AgUThDEUFavYs2rdy7ev4MJP1eCqwcNUHT+3Dr0YWsPMzdDWQuCS+CGEC/hd7f9AJHMyn/c7QrgZPdLmZp6DnnQUAfJwoyUuJ+ejxuiMQCl4DKMBkwL17YO7FvH+gHEGnnbi5KmnqLTjHKpYCQ6kAYAiAJIdqopvwXdMH0+GsQIvJeqGMYBF9sRVZooPGvIjBSZgdTQIpko0NSN9AjqryYWmioRzBIDYCogRbwSyhYRF7IaPMrPVEVMBmihwxvfEM8BEUpaRTwokLQS1zItCA9xdyRThQkDyt5KkA=" },
  hostile_links: { bytes: 471, sha256: "5e1f939edb28bcf70649c29753e116a5c1cf127ba34442b8ecb482579ebe5212", b64: "QlpoOTFBWSZTWaAjEVIAAfD/nP//////////yjUKAH5v3+AAgABAAAEICDABmSUA0SptTCaaYCaYAAAQBpgnoGgAANNBAOBpppoNDQ0MjQDIA0NAaaMgAAYTEBoJIppiJkk8o2QxQAAHqBk0NNAekBkBoaA0/VM/03f1wb77mvTszPA1yYWh8TCCl7RJKhgA2fFtNPbJ8CW341ayxiWSVTOIqSsQCxuAaknNVtZkjJN+mrCvhBEQBvIkWNHkSZUuZNnT6FGl4+Xn6evtGItmpUyQPmpVrV7H0nZtW7iyigAbGAGqhkAi+mkF7mkYCZjdjR7+BGCrmQgyJMIQbpvaHb4VREl6mFZ5ty8/lsPIwRa/JtEIDs1EYUQeMhQJinGejRF5N54VlJYKmLFNE6q4ev3PstljmR/OoCx6VGBFq2vIWxKAzb7VwKQqsDACBLAE4iW4pUEGlGPTKt5wN/+SUgM6wzQfdZ2Ab9oHWYBFFI9qedVN7HfQSqzOgotQIt4irgf2y0pQI/2PWLm61z6ci+NYXYQGAbhWFAjvGXNgxafGAygWyQNbz56WpKOBKF6vhcCmOrTCeUDogIvYMyC/cu/c5UgrwmJ+ZyAA/4u5IpwoSFARiKkA" },
  hostile_extra: { bytes: 410, sha256: "965285dd98afe70ef51c3dfeac1554289de76029ccd94696445a0165b725f161", b64: "QlpoOTFBWSZTWZ7mRXUAAZX/lP//////////6jUIAH9v32AAgAABCAgwAVlbYERCAaBoGmhoDRoAAAAAANMgNABFT8qGjQAAAAAAAABo9QAAAAAkkoNR6anpPTSYg0AAAGgGgBoDQADRoepJb+ixrVlttNGQ3JQcJDFyAk5hAa7bu3uOa0iuE6gIpbzwzkQofEkRuEUXnF41JkqdxUr9vxgWByQgAZp8GEZDiRYyEeQjJlS5k2dPoUaRggTfdRiICrWr2LNq3cu3r+Dxx2kRMjjiQ6xwTHqJpMulqQVhJVEMIF1lmz3TEIMYgBsF8xKAuiAI8xCIicRESRKAEGEAOWGPOQI9AVQAtApeSWQxK06ztmDaP8c/VHwytgBJQ09NZALMUKECSHNUCSBAiIzkOzhQy5tnNRLUtGeTBfAFsTF6Aj5aVAo435s+jCJ4TQIEQTy4hnSkCLMckMjXc56Cgj+Q36XaBFb9iiRTQ/Nb+E07Goyp6J/4Y4n5IJV+jJAQ+9EYApIZEVURRlDDqiA/xdyRThQkJ7mRXUA=" },
  hostile_dup: { bytes: 419, sha256: "3410a464d3387bb10d12e435480b5668e570faa257ae8c738fba37cd3f44992f", b64: "QlpoOTFBWSZTWecwPoEAAZh/lP//////////yjUIAH5v32AAgAABCAgwAVlKBEKaA0ABoaBoaAAABoAANHpA0AHA0aMQaNMmEGIDEYmjRo0AaaaAAAAJJJoRNkpnpoak9IyMjT0jCHqMJtTQ8mgRiGg8mmnqU5cjcfvvG+xEMhsEzhIYqgJOYQHwb5b7cBjRwhWmEWr8EboEV0Zwkiw4RPUcWWLTCtx1KOH/FzjCCEIAG+hQ4kWMhHkSUZUuZNnT6FGlTqHiAqfUYiAOxZtW7l29fwJcX0yfbGjQZGCZDsXFCRz7bLma0F4SVCGEC6F9+l6EYmD64WwtUL7BffzQDM0QznQxA9YAilwvwxZzqoaALgWENYsjNWw7aluH+OgKjTytwDioceVaezcqGCBDoqBSCBFF1Droq74uj1Ieno2FCL/gZRMtEBGNpO5iq+vZlFDcZDpECJPEqte0QvQI/U9uml08ZHITosIbMs9AjP9xmrTTIoRHId4ml1bND5kTZqBVqZYLiPSAitUsSClpRNZRoFjT0hAeAu5IpwoSHOYH0CA=" },
  pax_in: { bytes: 441, sha256: "21af51fc8981e427b88270f3fa9192312b9f537b5fa9f05a57bdf3cb56394939", b64: "QlpoOTFBWSZTWbLelR8AAaD/lv//////////ynVYAH5v32AAgAABBAAICDABWVtgVPVMmQBoBkGgNBoAAANAABpoA0AFNTU9CAAAAAAAAAAZAAAAACSSJH6p6noNT1DEAJgDSaYANAj0AAAHqT0jaWprNjTmg1Taa3TIb+SjkIaIQkazbm023txo3CVp7hENOu9nIiogwJF25IvHuL1imwqj6te+9sCwOSQIDDn8CDChxD4pkaPIQkypcybOn0GAhcEugDKkAIqVa1exZtW7l28ip+5kSyDkVnIdxf/gsW9SJtJMuZqi1xJXyGEC6ODp7PA0QxiUgN4iciRAicoCugNA44ggACgYYU0Z5fx4z1aa+ilMNXiWrhgKEUOtJH06nmtHYBZvZ6oCWMs0E+ZpyfEkpk3gkcgGEf1UPJyJs1FbQRDZmhFLWsvLmd3zkWynC0iC2FZCgyP78ioQGIAiRnOkCNz6tAU4TT0CI6I+CjVhQI6fq/tYzpbh745EfSGplJAiHYyZCRFxVQ1Rr8TPyqEFJFLGMoUVqN0GAjMARFIYIp9pGCilLc3hd/gQH2LuSKcKEhZb0qPg" },
  pax_out: { bytes: 439, sha256: "60eeb0d2d7ac05e9fbf6a5e163da287cd2a54aa25899c4c7348c356c76dfc2b7", b64: "QlpoOTFBWSZTWXWPgEcAAaD/lP//////////ynVYAH9v32AAgAEBCAgwAVlKBU1HogaAA0MjQaGgAANAAAGmgaGgA4NGjQNBoDJiAyNDIAA00yAAAYIACRSEwSYp+U1NqPTUGgYh6mgBp6gHigAANDGke1SzRwZuzvx9s3XKmh5ayCEOgQkdx5N1+CalGRVW2I8Os5nBEoUISK4JGrLAvs47FrTYMGT94cxBJA3ZZkCCbChxIrw6NHkHyZUuZNnTyQA4IphGVHhFTqVa1exZtIW7l1S/3RW0Vwx1ojz6fJllotT9hNet4F3UeZoFhQxAvae74/WQSLjXsmzeh0LytRRyRDbg4QjkUZnVrU6BnslyxUBIyshcEcRK8cWnU/13tgWZXYtQKONqAoKXMoxLiQsZODRcgjAOTUPvBG2jqcONEej+SCrln+eNEajRuNxSC4QN/iFBcsBGhwiuq0YIUy1ci4LidoTuIET3lPeKYkCPfp2MVjv1W5tStGlDvckaBHf6VRUie2hmETp2dWK6i7DnGyKeymEWuh7YCKLxiFr3LEYkcau3fNjniA/4u5IpwoSDrHwCOA==" },
  modes: { bytes: 471, sha256: "a5701639b396a14b340ecc5e0b5c6dae49b148fb3810fe341747a34d697f91bc", b64: "QlpoOTFBWSZTWbnmrSQAAcV/lf//////////yjUIAH5v32AAgAABABAIKDABeTLaDJJTT1NGExMAhkwNEYRhGmTTEwIGCGIYA0JMp6aU9TJoeoaADQGQAyDRoeo0wQAyAPKCSSKaepibJPUegQAA0AAGIAAAA0Bpp7/LenJq6y22LaYTccY4QMS0CTmQBsVtys7drWRPk1hr0FRsSoHM8KFE1JIvnApIHFBlRZKlBTseHdB6LwUSQEgQ4nVFjR5EmUxLmdfZNnT6Hb3UY4OSDn/FBSLKSEnf4VfGtX8rHnZtW9NzlBcoT6OAVXrM7heM0noMKF6RSJAEAEwQIrNwXe9YAJS0snGYFhI1pGgrmC612FdKIaNCKRimgGXYENzZk5wmQBsCQE+TApjHmvuZauMoYde6cmPQ90xXOMDHmfc+VlCaOc3ADji/egLKBkgywai0wluw1XZrsmAVx8eC4FVHkqoj6SnDimAiy0KqDS358l0QpSrwWgJUJAEIZocJrwOJawAQeRJcXEkllVOfbC7BiiBSBOdaH0CKBQp2pJBVBRELv5J0WPSgZmfuRR2iclLtzZH4hSsoBEyYPk8wEoyJi2KkKN4gwsFAH+LuSKcKEhc81aSA" },
  vad: { bytes: 221, sha256: "66ae59ee295e12c391b4fbb86343382cd13822829829ed41165797f534504dff", b64: "c2lsZXJvLXZhZC1kZS1wcnVlYmEtAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsc=" },
};
const GOOD_FILES: AssetFile[] = [
  { path: "model.onnx", bytes: 86, sha256: "de096ebb6e0552fd4846ab3b1888cfced910e87467a26480f9a3bcd52477e7ce" },
  { path: "tokens.txt", bytes: 255, sha256: "4f3e736fdd9b76a4c74a9ffd4ce571018f520e9be07a781c92ee2657699aa756" },
  { path: "LICENSE", bytes: 47, sha256: "1e27e6be9e51893610f73fb148c01cbdc4a610a2f2b6af370a9dbccff7175c99" },
];
const LONG_FILE: AssetFile = { path: "espeak-ng-data/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/lang/fichero-largo.txt", bytes: 38, sha256: "836dea32f6b0e36199646812f1eccc9d6713068e343e851ce4dd3e340fa5919b" };
const MODES_FILES: AssetFile[] = [
  { path: "setuid.bin", bytes: 19, sha256: "ea84de583a4f3bd39e33efaed2997a5948a85fa9c0630e70078ac63fb51b5ede" },
  { path: "solo-lectura.txt", bytes: 22, sha256: "7db26ddbb42261e37a4c0cfa058b21f929528c4c5641e9e589409b9dcd54ae2b" },
];

const ARCHIVE_NAME = "nido-activo-de-prueba.tar.bz2";
const SOURCE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ARCHIVE_NAME}`;
/** La Location de la forma medida: el CDN de GitHub declarando el nombre en sus parámetros. */
const CDN_LOCATION =
  "https://release-assets.githubusercontent.com/github-production-release-asset/531380835/00000000-0000-0000-0000-000000000000" +
  `?response-content-disposition=attachment%3B%20filename%3D${ARCHIVE_NAME}&sig=prueba`;

const fxBytes = (key: string): Uint8Array =>
  new Uint8Array(Buffer.from(FX[key].b64, "base64"));
const sha256Hex = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

function entryFor(fx: FxBlob, files: readonly AssetFile[] = GOOD_FILES): AssetEntry {
  return {
    id: "activo-prueba",
    label: "activo-prueba",
    kind: "asr",
    license: "CC-BY-4.0",
    sourceUrl: SOURCE_URL,
    revision: "asr-models",
    archiveBytes: fx.bytes,
    archiveSha256: fx.sha256,
    files,
    note: "batería hostil del paso 0 de E9",
  };
}

const VAD_ENTRY: AssetEntry = {
  id: "silero-vad",
  label: "silero-vad",
  kind: "vad",
  license: "MIT",
  sourceUrl:
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
  revision: "asr-models",
  archiveBytes: FX.vad.bytes,
  archiveSha256: FX.vad.sha256,
  files: [{ path: "silero_vad.onnx", bytes: FX.vad.bytes, sha256: FX.vad.sha256 }],
  note: "batería hostil del paso 0 de E9",
};

type FetchHandler = (
  url: string,
  call: number,
) => Promise<Response> | Response;

let fetchCalls: string[] = [];
function stubFetch(handler: FetchHandler): void {
  fetchCalls = [];
  vi.stubGlobal("fetch", async (url: unknown) => {
    fetchCalls.push(String(url));
    return handler(String(url), fetchCalls.length);
  });
}
const serveBytes =
  (bytes: Uint8Array) =>
  (): Response =>
    new Response(bytes as never, { status: 200 });

let assetsDir: string;
beforeEach(async () => {
  assetsDir = await mkdtemp(path.join(os.tmpdir(), "nido-e9-activos-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(assetsDir, { recursive: true, force: true });
});

/** Tras un rechazo de extracción: ni directorio final ni directorio de paso. */
async function expectNothingInstalled(entry: AssetEntry): Promise<void> {
  await expect(verifiedAssetDir(assetsDir, entry)).rejects.toBeInstanceOf(
    LoadRefusal,
  );
  const names = await readdir(assetsDir);
  expect(names).not.toContain(entry.id);
  expect(names).not.toContain(`${entry.id}.part`);
}

describe("downloadAsset y verifiedAssetDir: la puerta de activos de E9", () => {
  it("§4.7 clase 1: una ruta absoluta rechaza el paquete entero y no instala nada", async () => {
    const entry = entryFor(FX.hostile_absolute);
    stubFetch(serveBytes(fxBytes("hostile_absolute")));
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    await expectNothingInstalled(entry);
  });

  it("§4.7 clase 2: una ruta con .. rechaza el paquete entero y no instala nada", async () => {
    const entry = entryFor(FX.hostile_dotdot);
    stubFetch(serveBytes(fxBytes("hostile_dotdot")));
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    await expectNothingInstalled(entry);
  });

  it("§4.7 clase 3: enlaces y dispositivos rechazan el paquete entero y no instala nada", async () => {
    const entry = entryFor(FX.hostile_links);
    stubFetch(serveBytes(fxBytes("hostile_links")));
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    await expectNothingInstalled(entry);
  });

  it("§4.7 clase 4: un fichero fuera del manifiesto rechaza el paquete entero y no instala nada", async () => {
    const entry = entryFor(FX.hostile_extra);
    stubFetch(serveBytes(fxBytes("hostile_extra")));
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    await expectNothingInstalled(entry);
  });

  it("VA-03: la ruta efectiva manda — la extensión pax que aterriza en el manifiesto instala", async () => {
    const entry = entryFor(FX.pax_in);
    stubFetch(serveBytes(fxBytes("pax_in")));
    const result = await downloadAsset(entry, assetsDir);
    expect(result.dir).toBe(path.join(path.resolve(assetsDir), entry.id));
    for (const file of GOOD_FILES) {
      const onDisk = await readFile(path.join(result.dir, file.path));
      expect(onDisk.length).toBe(file.bytes);
      expect(sha256Hex(onDisk)).toBe(file.sha256);
    }
    const census = await censusAssets(assetsDir, { catalog: [entry] });
    expect(census.get(entry.id)?.state.kind).toBe("installed");
  });

  it("VA-03: la ruta efectiva manda — la extensión pax que saca el fichero del manifiesto rechaza el paquete entero", async () => {
    const entry = entryFor(FX.pax_out);
    stubFetch(serveBytes(fxBytes("pax_out")));
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    await expectNothingInstalled(entry);
  });

  it("VA-04: una ruta repetida dentro del paquete rechaza el paquete entero", async () => {
    const entry = entryFor(FX.hostile_dup);
    stubFetch(serveBytes(fxBytes("hostile_dup")));
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    await expectNothingInstalled(entry);
  });

  it("VA-05: una entrada setuid aterriza con los modos de la casa y su contenido intacto", async () => {
    const entry = entryFor(FX.modes, [...GOOD_FILES, ...MODES_FILES]);
    stubFetch(serveBytes(fxBytes("modes")));
    const result = await downloadAsset(entry, assetsDir);
    const landed = await stat(path.join(result.dir, "setuid.bin"));
    expect(landed.mode & 0o7777).toBe(0o644);
    const onDisk = await readFile(path.join(result.dir, "setuid.bin"));
    expect(sha256Hex(onDisk)).toBe(MODES_FILES[0].sha256);
  });

  it("VA-05: una entrada de solo lectura aterriza escribible por su dueño y con su contenido intacto", async () => {
    const entry = entryFor(FX.modes, [...GOOD_FILES, ...MODES_FILES]);
    stubFetch(serveBytes(fxBytes("modes")));
    const result = await downloadAsset(entry, assetsDir);
    const landed = await stat(path.join(result.dir, "solo-lectura.txt"));
    expect(landed.mode & 0o777).toBe(0o644);
    const onDisk = await readFile(path.join(result.dir, "solo-lectura.txt"));
    expect(sha256Hex(onDisk)).toBe(MODES_FILES[1].sha256);
  });

  it("VA-01: el salto legítimo al CDN de GitHub, con el nombre atado, instala", async () => {
    const entry = entryFor(FX.good);
    stubFetch((_url, call) => {
      if (call === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: CDN_LOCATION },
        });
      }
      return new Response(fxBytes("good") as never, {
        status: 200,
        headers: { "content-disposition": `attachment; filename=${ARCHIVE_NAME}` },
      });
    });
    const result = await downloadAsset(entry, assetsDir);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1]).toMatch(/^https:\/\/release-assets\.githubusercontent\.com\//);
    expect(result.dir).toBe(path.join(path.resolve(assetsDir), entry.id));
    const census = await censusAssets(assetsDir, { catalog: [entry] });
    expect(census.get(entry.id)?.state.kind).toBe("installed");
  });

  it("VA-01: un segundo salto rechaza y no se escribe nada", async () => {
    const entry = entryFor(FX.good);
    stubFetch(
      () =>
        new Response(null, { status: 302, headers: { location: CDN_LOCATION } }),
    );
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    expect(fetchCalls).toHaveLength(2);
    expect(await readdir(assetsDir)).toEqual([]);
  });

  it("VA-01: un salto a otro host rechaza en el primer salto y no se escribe nada", async () => {
    const entry = entryFor(FX.good);
    stubFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: `https://descargas-ejemplo.invalid/${ARCHIVE_NAME}`,
          },
        }),
    );
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    expect(fetchCalls).toHaveLength(1);
    expect(await readdir(assetsDir)).toEqual([]);
  });

  it("VA-02: el activo suelto se instala plano, sin extracción ni directorio de paso", async () => {
    stubFetch(serveBytes(fxBytes("vad")));
    const result = await downloadAsset(VAD_ENTRY, assetsDir);
    expect(result.dir).toBe(path.resolve(assetsDir));
    const onDisk = await readFile(path.join(assetsDir, "silero_vad.onnx"));
    expect(sha256Hex(onDisk)).toBe(FX.vad.sha256);
    expect(await readdir(assetsDir)).toEqual(["silero_vad.onnx"]);
    expect(await verifiedAssetDir(assetsDir, VAD_ENTRY)).toBe(path.resolve(assetsDir));
    const census = await censusAssets(assetsDir, { catalog: [VAD_ENTRY] });
    expect(census.get(VAD_ENTRY.id)?.state.kind).toBe("installed");
  });

  it("VA-09: un componente de directorio sustituido por un enlace invalida el árbol en la puerta", async () => {
    const entry = entryFor(FX.good_long, [...GOOD_FILES, LONG_FILE]);
    stubFetch(serveBytes(fxBytes("good_long")));
    const result = await downloadAsset(entry, assetsDir);
    const subdir = path.join(result.dir, "espeak-ng-data");
    const moved = path.join(assetsDir, "espeak-real");
    await rename(subdir, moved);
    await symlink(moved, subdir, "dir");
    await expect(verifiedAssetDir(assetsDir, entry)).rejects.toBeInstanceOf(
      LoadRefusal,
    );
  });

  it("VA-10: un cuerpo que nunca termina aborta contra los bytes declarados y lo escrito se descarta", async () => {
    const entry = entryFor(FX.good);
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(8192).fill(7));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(downloadAsset(entry, assetsDir)).rejects.toBeInstanceOf(LoadRefusal);
    expect(await readdir(assetsDir)).toEqual([]);
  });

  it("la puerta misma: el directorio de paso .part no es un nombre resoluble", async () => {
    const entry = entryFor(FX.good);
    stubFetch(serveBytes(fxBytes("good")));
    await downloadAsset(entry, assetsDir);
    await rename(
      path.join(assetsDir, entry.id),
      path.join(assetsDir, `${entry.id}.part`),
    );
    // El árbol válido existe solo bajo el paso: la puerta busca <id>.
    await expect(verifiedAssetDir(assetsDir, entry)).rejects.toBeInstanceOf(
      LoadRefusal,
    );
    // Y un id terminado en .part no resuelve ni con su árbol válido presente.
    const partEntry: AssetEntry = { ...entry, id: `${entry.id}.part` };
    await expect(verifiedAssetDir(assetsDir, partEntry)).rejects.toBeInstanceOf(
      LoadRefusal,
    );
  });
});
