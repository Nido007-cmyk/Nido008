/**
 * 0.1.90 · Familia 5 — el cuento del zorro en el peldaño de emergencia.
 *
 * Foto del dueño (15:45 MST, Tab A9+, 0.1.89): «Cuéntame un cuento muy
 * corto de un zorro que aprende a nadar» murió con «system (436) +
 * mensaje actual (101) + reserva (512) exceden nCtx 1024 sin siquiera
 * historial». El Qwen3 se había cargado en el peldaño de emergencia
 * (1024) de la escalera de contexto y los ensambladores exigían la
 * reserva pedida ENTERA antes de componer, aunque el suelo degradable
 * de H-12 (degradableGenTokens) ya recortaba la generación DESPUÉS.
 * La cura degrada la reserva ANTES de juzgar el núcleo
 * (effectiveReserveGeneration), con los mismos peldaños.
 *
 * Aceptación: (i) el cuento genera (el ensamblado no muere) en
 * conversación nueva y con historial, en el nCtx de emergencia;
 * (ii) las cuentas caben para cada modelo chico del catálogo, en su
 * nCtx de emergencia y en el de su plan canónico; (iii) el sistema
 * servido es byte a byte el mismo (la seguridad no se degrada).
 *
 * Asiento de PC (E3, tanda 2 · J-1): batería recreada del 0.1.108
 * bajo la decisión de puerta firmada en la apertura de la tanda
 * (estudios/E3-J1-PUERTA.md §4). Adaptaciones, todas asentadas:
 *   - Las personalidades son el adelanto A2 (verbatim, sede de la
 *     tanda 13) y `estimatePromptTokens` el adelanto A1 (la
 *     delegación misma del bucle, tanda 13): los casos que los usan
 *     corren contra la superficie verdadera.
 *   - `MODEL_CATALOG` viene de la fixture de datos (`__fixtures__/
 *     contextReserveFit.fixture.ts`): las 8 entradas `llm` del
 *     manifiesto móvil verbatim. La fixture prueba el ensamblado
 *     contra la tabla de origen; NO prueba la verdad del catálogo
 *     de PC (E0/E4). `EMERGENCY_CONTEXT` y `DEFAULT_MAX_TOKENS`
 *     vienen de producción (`inference/memoryLadder.ts` y
 *     `models/settings.ts`), con el mismo valor que la fixture
 *     traía (1024 y 1024, cobrados en la prep de la pieza).
 *   - Los SIETE casos que afirmaban el planificador quedaron
 *     DIFERIDOS a E4 con nombre en la recreación, y E4 cerró sin
 *     cobrarlos. Se cobran en el acto 4 del bloque de piezas
 *     sueltas, contra el planificador y el
 *     catálogo de PC, en el bloque «cobro del diferido de J-1» al
 *     final de esta batería: las cuatro funciones se importan de
 *     producción y la fixture `__fixtures__/diferidosJ1.ts` se
 *     borra cumpliendo su propia cabecera. De los 7: 5 nacen
 *     cobrados (los canónicos de (ii) y (iv) por los 2 modelos
 *     chicos que el catálogo de PC sí lleva, y el fijo del techo
 *     en su forma PC) y las 2 iteraciones del
 *     `qwen2.5-0.5b-instruct-q5km` SE RETIRAN CON CAUSA: el Q5 era
 *     candidato A/B del móvil y no es una entrada del catálogo de
 *     PC, así que no hay plan de PC que afirmar de él; la
 *     aceptación que cargaban queda cobrada para los dos modelos
 *     chicos de PC, con la misma arquitectura del 0.5B entre
 *     ellos (el Q4_K_M comparte `arch` con el Q5: 24 capas, 2
 *     cabezas KV, dim 64).
 *   - Las fotos de máquina del bloque del cobro, con su
 *     procedencia: `PC_RAM_BYTES` = 8.319.897.600 (7,75 GiB), la
 *     RAM total MEDIDA en la VM de la casa el 2026-11-20
 *     (`MemTotal: 8.124.900 KiB` en `/proc/meminfo`); es la
 *     máquina donde la casa construye y prueba PC, declarada
 *     como tal: no es un aparato del dueño, no es un mínimo
 *     soportado y no promete hardware alguno. Es constante
 *     literal para que la batería sea reproducible.
 *     `SMALL_CLASS_RAM` = 4 GiB exactos: foto de CLASE, no de
 *     aparato; es el borde que el propio código de producción
 *     define para la clase ≤4 GiB (`EMERGENCY_CLASS_MAX_RAM_BYTES`
 *     en `memoryLadder.ts`), y sustituye a la Tab A9+ en el caso
 *     cuya sustancia es esa clase (el fijo del techo): la Tab era
 *     la instancia medida de la clase en el móvil; en PC la clase
 *     se cobra en su borde, que es lo que la regla mira.
 *   - El `vi.mock("ram-monitor")` del original queda: en el móvil
 *     sustituía el monitor que la pila de planificación leía; en PC
 *     ninguna pieza del grafo de esta batería lo importa (el
 *     planificador cobra la foto que se le pasa, no lee monitor),
 *     así que el mock es inerte y se conserva para que la copia
 *     siga siendo la batería del contrato.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));

import { assembleChatMessages, assemblePrompt, degradableGenTokens, effectiveReserveGeneration } from "./pure.js";
import { defaultTokenCounter } from "../agent/loop/contextBudget.js";
import { estimatePromptTokens } from "../agent/loop/agentLoop.js";
import { PERSONALITIES } from "../constants/personalities.js";
import { MODEL_CATALOG } from "./__fixtures__/contextReserveFit.fixture.js";
import { planContext, EMERGENCY_CONTEXT } from "../inference/memoryLadder.js";
import { contextSpecForModel, contextCeilingForDevice } from "../models/defaultModel.js";
import { canonicalSnapshot } from "../models/compatibility.js";
import { MODEL_CATALOG as PC_MODEL_CATALOG } from "../models/manifest.js";
import { DEFAULT_MAX_TOKENS } from "../models/settings.js";

const STORY = "Cuéntame un cuento muy corto de un zorro que aprende a nadar";
const succinct = PERSONALITIES.find((p) => p.id === "succinct")!;
// Las fotos del bloque del cobro (procedencia en la cabecera):
// la RAM medida de la VM de la casa y el borde de la clase ≤4 GiB.
const PC_RAM_BYTES = 8319897600;
const SMALL_CLASS_RAM = 4 * 1024 * 1024 * 1024;

const storyBudget = (nCtx: number) => ({ nCtx, reserveGeneration: 512 });

describe("effectiveReserveGeneration: la reserva baja por los peldaños de H-12", () => {
  it("sin estrechez, la reserva pedida queda intacta", () => {
    expect(effectiveReserveGeneration(512, 4096, 537)).toBe(512);
  });
  it("en el peldaño de emergencia, baja a lo que el núcleo deja (487)", () => {
    expect(effectiveReserveGeneration(512, 1024, 436 + 101)).toBe(487);
  });
  it("nunca baja del suelo de 64", () => {
    expect(effectiveReserveGeneration(512, 1024, 980)).toBe(64);
  });
});

describe("familia 5 (i): el cuento del zorro en nCtx 1024", () => {
  it("conversación nueva: el ensamblado ya no muere y el cuento entra entero", () => {
    const msgs = assembleChatMessages(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    expect(msgs[0].role).toBe("system");
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain(STORY);
    // Queda generación real: el núcleo + el suelo de 64 cabe.
    const core = defaultTokenCounter(msgs[0].content) + defaultTokenCounter(last.content);
    expect(core + 64).toBeLessThanOrEqual(EMERGENCY_CONTEXT);
  });

  it("con historial de guías y resumen: tampoco muere; el historial se recorta, el sistema no", () => {
    const history = {
      summary:
        "El usuario preguntó por una fuga de gas en casa y se le sirvió la guía de SALVORA PACKS; después descargó y activó el modelo Qwen3-0.6B.",
      turns: [
        { role: "user" as const, text: "Mi casa huele a gas, ¿qué hago?" },
        { role: "assistant" as const, text: "Sal a pie de la casa y llama desde fuera. No enciendas luces ni aparatos." },
        { role: "user" as const, text: "¿Y si es el monóxido de carbono?" },
        { role: "assistant" as const, text: "El monóxido no se puede oler; por eso lleva detector." },
      ],
    };
    const msgs = assembleChatMessages(
      STORY, [], succinct.systemPrompt, history, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    const last = msgs[msgs.length - 1];
    expect(last.content).toContain(STORY);
    // El resumen (parte del sistema) sigue presente entero.
    expect(msgs[0].content).toContain("Fuga de gas".toLowerCase().length >= 0 ? "fuga de gas" : "");
    // El total estimado con la reserva efectiva cabe en la ventana.
    const total = msgs.reduce((acc, m) => acc + defaultTokenCounter(m.content), 0);
    expect(total).toBeLessThanOrEqual(EMERGENCY_CONTEXT);
  });

  it("la vía de prompt en texto también deja sitio de generación en 1024", () => {
    const prompt = assemblePrompt(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    expect(prompt).toContain(STORY);
    expect(defaultTokenCounter(prompt) + 64).toBeLessThanOrEqual(EMERGENCY_CONTEXT);
  });

  it("la guarda honesta sigue: un núcleo que no cabe ni con 64 sigue muriendo", () => {
    const huge = "x".repeat(2400);
    expect(() =>
      assembleChatMessages(huge, [], succinct.systemPrompt, undefined, succinct.styleReminder, false, storyBudget(EMERGENCY_CONTEXT))
    ).toThrow(/sin siquiera historial/);
  });
});

describe("familia 5 (ii): las cuentas por modelo chico del catálogo", () => {
  const small = MODEL_CATALOG.filter(
    (m) => m.kind === "llm" && (m.sizeBytes ?? 0) > 0 && (m.sizeBytes ?? 0) <= 500 * 1024 * 1024
  );

  it("el censo de modelos chicos no viene vacío", () => {
    expect(small.length).toBeGreaterThanOrEqual(3);
  });

  for (const model of small) {
    it(`${model.id}: el cuento cabe en su nCtx de emergencia (${EMERGENCY_CONTEXT})`, () => {
      const msgs = assembleChatMessages(
        STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
        storyBudget(EMERGENCY_CONTEXT)
      );
      expect(msgs[msgs.length - 1].content).toContain(STORY);
    });

    // El gemelo canónico de este caso (el nCtx del plan contra el
    // planificador y el catálogo de PC) se cobra en el bloque
    // «cobro del diferido de J-1» al final de la batería: sale de
    // este bucle porque itera el catálogo de PC, no esta fixture.
  }
});

describe("familia 5 (iv): la propuesta aplicada — respuestas completas, no cortadas por tope", () => {
  // La fórmula EXACTA de ChatScreen: ensamblar con el presupuesto,
  // estimar el prompt servido y degradar el deseo sobre lo que queda.
  const chatGenTokens = (query: string, personalityId: string, nCtx: number): number => {
    const p = PERSONALITIES.find((x) => x.id === personalityId)!;
    const msgs = assembleChatMessages(query, [], p.systemPrompt, undefined, p.styleReminder, false, {
      nCtx,
      reserveGeneration: DEFAULT_MAX_TOKENS,
    });
    const joined = msgs.map((m) => m.content).join("\n");
    return degradableGenTokens(DEFAULT_MAX_TOKENS, nCtx - estimatePromptTokens(joined) - 64).genTokens;
  };
  const EMAIL = "Redacta un correo breve y amable para pedir un día libre el viernes a mi jefe";
  const TIRE = "Explícame cómo cambiar una llanta en 5 pasos numerados, cada paso con una sola línea";
  const MiB = 1024 * 1024;
  const small = MODEL_CATALOG.filter(
    (m) => m.kind === "llm" && (m.sizeBytes ?? 0) > 0 && (m.sizeBytes ?? 0) <= 500 * 1024 * 1024
  );

  it("el tope por defecto deja de ser 512: es 1024 (ya ofrecido en Ajustes)", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(1024);
  });

  // El caso fijo del techo y los gemelos canónicos de aceptación
  // de este bucle se cobran en el bloque «cobro del diferido de
  // J-1» al final de la batería, contra el planificador y el
  // catálogo de PC (el fijo, en su forma PC asentada allí).

  for (const model of small) {
    it(`${model.id}: en el peldaño de emergencia la batería concisa sigue entera`, () => {
      expect(chatGenTokens(TIRE, "succinct", EMERGENCY_CONTEXT), "llanta").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(STORY, "succinct", EMERGENCY_CONTEXT), "cuento").toBeGreaterThanOrEqual(400);
      expect(chatGenTokens(EMAIL, "succinct", EMERGENCY_CONTEXT), "correo").toBeGreaterThanOrEqual(400);
    });
  }
});

describe("familia 5 (iii): el sistema servido no se degrada", () => {
  it("el mensaje de sistema en 1024 es byte a byte el de una ventana ancha", () => {
    const narrow = assembleChatMessages(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(EMERGENCY_CONTEXT)
    );
    const wide = assembleChatMessages(
      STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
      storyBudget(8192)
    );
    expect(narrow[0].content).toBe(wide[0].content);
    expect(narrow[0].content).toContain("You are Nido");
  });
});

describe("familia 5 · cobro del diferido de J-1: el plan canónico contra el planificador y el catálogo de PC", () => {
  // Los 7 casos diferidos de las familias (ii) y (iv), cobrados en
  // el acto 4 del bloque de piezas sueltas contra la pieza real:
  // las cuatro funciones vienen de producción y el catálogo es el
  // de PC. Los modelos chicos de PC son 2 (el censo de §1.1 de la
  // prep): qwen3-0.6b-q4km y qwen2.5-0.5b-instruct-q4km; las
  // iteraciones del q5km se retiran con la causa de la cabecera.
  const MiB = 1024 * 1024;
  const pcSmall = PC_MODEL_CATALOG.filter(
    (m) => m.kind === "llm" && (m.sizeBytes ?? 0) > 0 && (m.sizeBytes ?? 0) <= 500 * 1024 * 1024
  );

  const canonicalPlan = (model: (typeof pcSmall)[number]) => {
    const ceiling = contextCeilingForDevice(model.defaultNCtx, PC_RAM_BYTES);
    const { nCtx: _planned, ...specBase } = contextSpecForModel(model, PC_RAM_BYTES);
    return planContext(specBase, canonicalSnapshot(PC_RAM_BYTES), { ceiling, safety: 1 });
  };

  // La misma fórmula de aceptación de la familia (iv), con el tope
  // de producción: ensamblar con el presupuesto, estimar el prompt
  // servido y degradar el deseo sobre lo que queda.
  const chatGenTokensPC = (query: string, personalityId: string, nCtx: number): number => {
    const p = PERSONALITIES.find((x) => x.id === personalityId)!;
    const msgs = assembleChatMessages(query, [], p.systemPrompt, undefined, p.styleReminder, false, {
      nCtx,
      reserveGeneration: DEFAULT_MAX_TOKENS,
    });
    const joined = msgs.map((m) => m.content).join("\n");
    return degradableGenTokens(DEFAULT_MAX_TOKENS, nCtx - estimatePromptTokens(joined) - 64).genTokens;
  };
  const EMAIL = "Redacta un correo breve y amable para pedir un día libre el viernes a mi jefe";
  const TIRE = "Explícame cómo cambiar una llanta en 5 pasos numerados, cada paso con una sola línea";

  for (const model of pcSmall) {
    it(`${model.id}: el cuento cabe en el nCtx de su plan canónico en la foto de PC`, () => {
      const plan = canonicalPlan(model);
      expect(plan).not.toBeNull();
      const msgs = assembleChatMessages(
        STORY, [], succinct.systemPrompt, undefined, succinct.styleReminder, false,
        storyBudget(plan!.nCtx)
      );
      expect(msgs[msgs.length - 1].content).toContain(STORY);
    });

    it(`${model.id}: la batería de aceptación sale entera en su contexto canónico`, () => {
      const plan = canonicalPlan(model);
      expect(plan).not.toBeNull();
      const nCtx = plan!.nCtx;
      // Una respuesta normal (5 pasos de una línea, un cuento muy
      // corto, un correo breve) necesita unas centenas de tokens; el
      // suelo de 400 deja margen de sobra sobre su forma real, y la
      // explicación desarrollada (tono Detallado) pide 800.
      expect(chatGenTokensPC(TIRE, "succinct", nCtx), "llanta concisa").toBeGreaterThanOrEqual(400);
      expect(chatGenTokensPC(STORY, "succinct", nCtx), "cuento conciso").toBeGreaterThanOrEqual(400);
      expect(chatGenTokensPC(EMAIL, "succinct", nCtx), "correo conciso").toBeGreaterThanOrEqual(400);
      expect(chatGenTokensPC(TIRE, "detailed", nCtx), "llanta detallada").toBeGreaterThanOrEqual(800);
    });
  }

  it("el techo del Qwen3, en su forma PC: la regla vive en la clase y su entrada planifica a su techo de PC", () => {
    // Adaptación asentada (prep §1.4): la narrativa original (el
    // estimado a 3072, los 842 MB libres de la tableta, el rechazo
    // medido en el aparato del dueño) es historia del móvil que en
    // PC no se puede volver a afirmar como medición propia. Lo que
    // el caso nació para fijar se cobra con los valores que la
    // geometría de PC da:
    // 1. La regla del techo, con argumentos literales, que es donde
    //    la regla vive en PC: 3072 se queda en 3072 fuera de la
    //    clase y baja a 2048 en su borde.
    expect(contextCeilingForDevice(3072, SMALL_CLASS_RAM)).toBe(2048);
    expect(contextCeilingForDevice(3072, PC_RAM_BYTES)).toBe(3072);
    // 2. La entrada de PC del Qwen3 no declara defaultNCtx (el
    //    adaptador no lo asigna a ninguna entrada): su techo es
    //    4096 y su plan canónico en la foto de clase es 4096.
    const q3 = PC_MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;
    const ceiling = contextCeilingForDevice(q3.defaultNCtx, SMALL_CLASS_RAM);
    expect(ceiling).toBe(4096);
    const { nCtx: _c, ...spec } = contextSpecForModel(q3, SMALL_CLASS_RAM);
    expect(planContext(spec, canonicalSnapshot(SMALL_CLASS_RAM), { ceiling, safety: 1 })?.nCtx).toBe(4096);
    // 3. Sobre la foto viva estrecha de la clase (la misma forma de
    //    foto del caso original, declarada foto de clase sintética
    //    y no aparato): sin crédito liberable el plan cae al
    //    peldaño de emergencia; con 470 MiB liberables se sostiene
    //    en 2048. La misma conducta: el crédito sostiene el
    //    contexto y sin él manda la emergencia.
    const live = { totalRamBytes: SMALL_CLASS_RAM, rssBytes: 367 * MiB, availBytes: 842 * MiB, lowMemThresholdBytes: 216 * MiB };
    expect(planContext(spec, live, { ceiling, safety: 1 })?.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(planContext(spec, { ...live, releasableBytes: 470 * MiB }, { ceiling, safety: 1 })?.nCtx).toBe(2048);
  });
});
