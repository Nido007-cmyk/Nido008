/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * packCatalog.ts — las entradas de paquetes del catálogo firmado,
 * en su módulo propio de PC. ADELANTO de E5 firmado en la apertura
 * de J-3 (vía A de estudios/E5-PACKS-FRONTERA.md §3.1): entra con
 * las entradas y los pins tomados fichero a fichero del catálogo
 * firmado del móvil (src/models/manifest.ts del 0.1.108: las 20
 * entradas `sqlite-pack`, 10 familias × 2 variantes), sin la
 * decisión de la fuente de descarga ni el contraste del paso 3,
 * que quedan en E5 — esa etapa hereda este fichero y lo completa.
 * No cobra ni un caso en la puerta de J-3.
 *
 * En el móvil estas entradas viven dentro de MODEL_CATALOG y
 * CORPUS_CATALOG se deriva de él; en PC el manifiesto de modelos
 * (src/models/manifest.ts) es un adaptador sobre el catálogo de
 * E0 y no declara paquetes: la verdad de paquetes vive aquí.
 */

import type { CatalogModel } from "./manifest.js";

/** Una entrada de paquete del catálogo: la forma del manifiesto móvil. */
export interface PackCatalogEntry extends CatalogModel {
  format: "sqlite-pack";
}

export const PACK_CATALOG: PackCatalogEntry[] = [
  {
      // NIDO Esencial: 58 guides in each of Spanish, English and Portuguese
      // (first aid, health
      // at home, disasters, survival) written by NIDO from IFRC, Red Cross, AHA,
      // WHO, UNICEF, CDC, Ready.gov and other public guidance
      // (knowledge-packs/nido-esencial, built and checked by
      // .github/workflows/knowledge-pack.yml).
      id: "nido-esencial",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Essentials: first aid, health, disasters, survival",
      filename: "corpus/nido-esencial.sqlite",
      sizeBytes: 1286144,
      sha256: "b57fa32a3849a0edda89c84b96f2eab526489df195a168e59f8536fc78fd5d60",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v16/nido-esencial.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description: "174 offline guides (58 each in Spanish, English and Portuguese) on first aid, health at home, disasters and survival. ~1.25MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors, offered instead of
      // nido-esencial when multilingual search is on (src/rag/embeddingSwitch.ts).
      id: "nido-esencial-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Essentials (multilingual search)",
      filename: "corpus/nido-esencial-e5.sqlite",
      sizeBytes: 1286144,
      sha256: "c4d49aa945199520af9273cf5fd02f52d26eda7f82b1c41c65f121a635706c92",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v16/nido-esencial-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "174 offline guides on first aid, health at home, disasters and survival, searchable in Spanish, Portuguese and English. ~1.25MB.",
      required: false,
    },
  {
      // NIDO Local (0.1.55; grown in 0.1.65): guides by country in Spanish +
      // English for 69 countries — checked emergency numbers (facts table
      // with source, quote and date: pack format v2) and what each official
      // alert means. knowledge-packs/nido-local, built and checked by
      // .github/workflows/knowledge-pack.yml. Corrected edition in
      // 0.1.66 (knowledge-packs-v7): the Argentina 107 and Philippines
      // 911 facts are backed by reachable official sources, and three
      // facts that cited press reports now cite the official source.
      // Corrected edition in 0.1.67 (knowledge-packs-v8): the Portugal
      // fact now quotes its source's exact phrase. Trilingual edition
      // in 0.1.68 (knowledge-packs-v9): the 23 country guides now
      // exist in Portuguese too, digit parity with the Spanish
      // originals checked guide by guide.
      id: "nido-local",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Local: emergency numbers and alerts by country",
      filename: "corpus/nido-local.sqlite",
      sizeBytes: 376832,
      sha256: "df5f050bd96600d825dc6e1263673a93863973a63714fc9c744558c884957ddc",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v9/nido-local.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "Checked emergency numbers for 69 countries in the Americas, Europe, Africa, Asia and Oceania, each with its official source, plus what official alerts mean. Spanish, English and Portuguese. ~0.4MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-local-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Local (multilingual search)",
      filename: "corpus/nido-local-e5.sqlite",
      sizeBytes: 376832,
      sha256: "1647431996507545093904985af807b318d6127935b311c51dbab01cde22aa3c",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v9/nido-local-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "Checked emergency numbers for 69 countries, each with its official source, plus what official alerts mean; searchable in Spanish, Portuguese and English. ~0.4MB.",
      required: false,
    },
  {
      // NIDO Niños (0.1.65): first aid and health for babies and children,
      // organised by age, in Spanish, English and Portuguese.
      // knowledge-packs/nido-ninos, built and checked by
      // .github/workflows/knowledge-pack.yml.
      id: "nido-ninos",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Children and Babies: first aid and health by age",
      filename: "corpus/nido-ninos.sqlite",
      sizeBytes: 290816,
      sha256: "d9c767a807fb5a59de9f638f7bb58bf690d1fe6e297a57d1ab251cff03969b9a",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-ninos.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides (6 each in Spanish, English and Portuguese) on first aid and health for babies and children, organised by age. ~0.3MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-ninos-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Children and Babies (multilingual search)",
      filename: "corpus/nido-ninos-e5.sqlite",
      sizeBytes: 290816,
      sha256: "aa95a7c44271b634b8d8eb1ed45ddb6bb77be89c1fe5a85af999479495af2343",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-ninos-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides on first aid and health for babies and children, organised by age, searchable in Spanish, Portuguese and English. ~0.3MB.",
      required: false,
    },
  {
      // NIDO Crisis (0.1.65): guides for the hardest moments and verified
      // crisis lines for 14 countries (facts table with source, quote and
      // date: pack format v2). knowledge-packs/nido-crisis, built and
      // checked by .github/workflows/knowledge-pack.yml. Search
      // metadata of the grief guide corrected in 0.1.66
      // (knowledge-packs-v7).
      id: "nido-crisis",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Crisis: support in the hardest moments",
      filename: "corpus/nido-crisis.sqlite",
      sizeBytes: 233472,
      sha256: "2169f1290a2f696039697ffcb276536fef59c73281b987aab559973e88cde627",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v7/nido-crisis.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "12 offline guides (4 each in Spanish, English and Portuguese) for the hardest moments: when someone talks about dying, panic attacks and grief, with verified crisis lines for 14 countries. ~0.2MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-crisis-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Crisis (multilingual search)",
      filename: "corpus/nido-crisis-e5.sqlite",
      sizeBytes: 233472,
      sha256: "70e73fa2dc80f80bb699702af4ff958818d63373160853f3138b090602f6a5e3",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v7/nido-crisis-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "12 offline guides for the hardest moments: when someone talks about dying, panic attacks and grief, with verified crisis lines for 14 countries; searchable in Spanish, Portuguese and English. ~0.2MB.",
      required: false,
    },
  {
      // NIDO Sin Servicios (0.1.65): living at home without water,
      // electricity or gas, in Spanish, English and Portuguese.
      // knowledge-packs/nido-sin-servicios, built and checked by
      // .github/workflows/knowledge-pack.yml.
      id: "nido-sin-servicios",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Without Utilities: at home when services fail",
      filename: "corpus/nido-sin-servicios.sqlite",
      sizeBytes: 270336,
      sha256: "fee95e7e61e2d9ad81e9d3a94aa1ca7f21904cce698e19257a4b73e6455710fe",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-sin-servicios.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides (6 each in Spanish, English and Portuguese) on living at home when the services fail: without water, electricity or gas. ~0.3MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-sin-servicios-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Without Utilities (multilingual search)",
      filename: "corpus/nido-sin-servicios-e5.sqlite",
      sizeBytes: 270336,
      sha256: "43ac93c2041ebc003bd220c0361e40f1efd8c7ac376e550a3a1e37b4f7c6dac1",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-sin-servicios-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides on living at home when the services fail: without water, electricity or gas; searchable in Spanish, Portuguese and English. ~0.3MB.",
      required: false,
    },
  {
      // NIDO Hogar Seguro (0.1.65): preventing and answering the dangers
      // of the house, in Spanish, English and Portuguese.
      // knowledge-packs/nido-hogar, built and checked by
      // .github/workflows/knowledge-pack.yml.
      id: "nido-hogar",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Safe Home: preventing dangers at home",
      filename: "corpus/nido-hogar.sqlite",
      sizeBytes: 290816,
      sha256: "c9cab0fdb26a6a3640f0d24322c163d798ba971b992abf50410d0e6f69065c5c",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-hogar.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "21 offline guides (7 each in Spanish, English and Portuguese) on preventing and answering the dangers of the house. ~0.3MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-hogar-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Safe Home (multilingual search)",
      filename: "corpus/nido-hogar-e5.sqlite",
      sizeBytes: 290816,
      sha256: "61099ad28c98a79c7ca919ba8a5c1f564e6137371290371d644c378ef3e29966",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-hogar-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "21 offline guides on preventing and answering the dangers of the house, searchable in Spanish, Portuguese and English. ~0.3MB.",
      required: false,
    },
  {
      // NIDO Desastres (0.1.65): specific disasters by region, in Spanish,
      // English and Portuguese. knowledge-packs/nido-desastres, built and
      // checked by .github/workflows/knowledge-pack.yml.
      id: "nido-desastres",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Disasters: guides by region",
      filename: "corpus/nido-desastres.sqlite",
      sizeBytes: 294912,
      sha256: "c9241f9fcdde9c8c74844cd7df15a13857d77e406c7780b7b73a9ffb9a93923a",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-desastres.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides (6 each in Spanish, English and Portuguese) on specific disasters by region, beyond the Essentials pack. ~0.3MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-desastres-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Disasters (multilingual search)",
      filename: "corpus/nido-desastres-e5.sqlite",
      sizeBytes: 294912,
      sha256: "3bde004bb81546bdd80d4574d4035b4d3d68031afe83fc7dbb2454b27b52f739",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-desastres-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides on specific disasters by region, beyond the Essentials pack, searchable in Spanish, Portuguese and English. ~0.3MB.",
      required: false,
    },
  {
      // NIDO Campo (0.1.65): life in the country and with animals, in
      // Spanish, English and Portuguese. knowledge-packs/nido-campo, built
      // and checked by .github/workflows/knowledge-pack.yml.
      id: "nido-campo",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Field and Animals: country life and animals",
      filename: "corpus/nido-campo.sqlite",
      sizeBytes: 327680,
      sha256: "5f62d994843d599cef77c43688759730420d2539d7aa231b4454208e349c34cc",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-campo.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description: "18 offline guides (6 each in Spanish, English and Portuguese) on life in the country and with animals. ~0.3MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-campo-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Field and Animals (multilingual search)",
      filename: "corpus/nido-campo-e5.sqlite",
      sizeBytes: 327680,
      sha256: "644196d28a0e030c9fe1551146c25e96fa37b282dd1ba504c99829d71f751139",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v6/nido-campo-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description:
        "18 offline guides on life in the country and with animals, searchable in Spanish, Portuguese and English. ~0.3MB.",
      required: false,
    },
  {
      // NIDO Viaje (0.1.65): the road and car travel, in Spanish, English
      // and Portuguese. knowledge-packs/nido-viaje, built and checked by
      // .github/workflows/knowledge-pack.yml. Search metadata of the
      // minor crash guide corrected in 0.1.66 (knowledge-packs-v7).
      id: "nido-viaje",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Road Travel: the road and car trips",
      filename: "corpus/nido-viaje.sqlite",
      sizeBytes: 241664,
      sha256: "051b11805f154b84da4f7d88664428cb991ed18d0ae920dae67971074d95f791",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v7/nido-viaje.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description: "18 offline guides (6 each in Spanish, English and Portuguese) for the road and car travel. ~0.2MB.",
      required: false,
    },
  {
      // Same guides with multilingual-e5 vectors (src/rag/embeddingSwitch.ts).
      id: "nido-viaje-e5",
      kind: "corpus",
      format: "sqlite-pack",
      label: "NIDO Road Travel (multilingual search)",
      filename: "corpus/nido-viaje-e5.sqlite",
      sizeBytes: 241664,
      sha256: "28c4bf3996b10d8bdc09f8b8470eb0a9606d90f8d2236b82b3ffa7975a038709",
      sourceUrl: "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v7/nido-viaje-e5.sqlite",
      license: "CC BY 4.0 (NIDO)",
      description: "18 offline guides for the road and car travel, searchable in Spanish, Portuguese and English. ~0.2MB.",
      required: false,
    }];

export const CORPUS_CATALOG = PACK_CATALOG;
