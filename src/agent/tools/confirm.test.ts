/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// Los handlers importan react-native de forma dinámica: se mockea el módulo.
// También se mockean los módulos nativos que no existen fuera del teléfono.
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SENSITIVE_TOOLS, confirmBlockedMessage, withConfirmation } from "./confirm.js";
import { buildToolHandlers, setHandlerLangForTest } from "./handlers.js";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import { listEvents } from "../memory/calendarStore.js";

describe("confirm: puerta de confirmación", () => {
  it("SENSITIVE_TOOLS declara las herramientas con efectos externos silenciosos", () => {
    expect(SENSITIVE_TOOLS.has("create_calendar_event")).toBe(true);
    expect(SENSITIVE_TOOLS.has("nido_send_message")).toBe(true);
    // nido_pair: emparejar verifica una identidad ajena; el modelo de
    // confianza exige que un humano haya visto el QR en persona.
    expect(SENSITIVE_TOOLS.has("nido_pair")).toBe(true);
    // M-6: decidir sobre una tarea remota encolada es una acción sensible.
    expect(SENSITIVE_TOOLS.has("nido_approve_task")).toBe(true);
    expect(SENSITIVE_TOOLS.has("nido_reject_task")).toBe(true);
    // Forma A del catálogo (cura O-1): open_app salió del catálogo
    // de PC entero; ya no es sensible porque ya no es herramienta.
    expect(SENSITIVE_TOOLS.has("open_app")).toBe(false);
    expect(SENSITIVE_TOOLS.has("nido_review_tasks")).toBe(false); // solo lectura
    // Forma A del catálogo (bloque de piezas sueltas): place_call y
    // send_sms salieron del catálogo de PC enteros; ya no son
    // herramientas sensibles porque ya no son herramientas.
    expect(SENSITIVE_TOOLS.has("place_call")).toBe(false);
    expect(SENSITIVE_TOOLS.has("send_sms")).toBe(false);
    expect(SENSITIVE_TOOLS.has("save_note")).toBe(false);
  });

  it("confirmado → ejecuta el handler", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation("x", inner, async () => true, () => ({
      tool: "x",
      title: "T",
      message: "M",
    }));
    await expect(wrapped({})).resolves.toBe("hecho");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("cancelado → NO ejecuta y avisa", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation("x", inner, async () => false, () => ({
      tool: "x",
      title: "T",
      message: "M",
    }));
    const out = await wrapped({});
    expect(out).toMatch(/I did nothing/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it("si el diálogo lanza → no se ejecuta (fail-closed)", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation(
      "x",
      inner,
      async () => {
        throw new Error("ui rota");
      },
      () => ({ tool: "x", title: "T", message: "M" }),
    );
    const out = await wrapped({});
    expect(out).toMatch(/I did nothing/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it("M-3: sin canal de confirmación → NO ejecuta (fail-closed)", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation("x", inner, undefined, () => ({
      tool: "x",
      title: "T",
      message: "M",
    }));
    const out = await wrapped({});
    expect(inner).not.toHaveBeenCalled();
    expect(out).toMatch(/blocked for security/i);
    expect(out).toMatch(/was NOT executed/i);
  });

  it("M-3: si describe lanza (no hay consentimiento informado posible) → fail-closed", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation(
      "x",
      inner,
      async () => true, // el canal existe, pero no se llega a usar
      () => {
        throw new Error("no se pudo describir la acción");
      },
    );
    const out = await wrapped({});
    expect(inner).not.toHaveBeenCalled();
    expect(out).toMatch(/blocked for security/i);
  });

  it("M-3: canal roto (reject) → NO ejecuta", async () => {
    const inner = vi.fn(async () => "hecho");
    const wrapped = withConfirmation(
      "x",
      inner,
      async () => Promise.reject(new Error("canal caído")),
      () => ({ tool: "x", title: "T", message: "M" }),
    );
    const out = await wrapped({});
    expect(inner).not.toHaveBeenCalled();
    expect(out).toMatch(/I did nothing/i);
  });

  it("el diálogo recibe un resumen claro de la acción", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const wrapped = withConfirmation(
      "create_calendar_event",
      async () => "hecho",
      async (req) => {
        seen.push(req);
        return true;
      },
      (args) => ({
        tool: "create_calendar_event",
        title: "Crear evento",
        message: `¿Crear «${args.title}»?`,
      }),
    );
    await wrapped({ title: "Dentista" });
    expect(seen[0].message).toContain("Dentista");
  });
});

describe("confirm: integración con handlers", () => {
  // Reconciliación I18N-2 (extensión dirimida por el coordinador,
  // con su causa): cuatro casos de este describe cobran textos
  // servidos por L() en español («Evento creado», «Recordatorio
  // guardado», «Mensaje para «Beto» guardado…», «Indica el nombre
  // de la skill…») y nunca fijaban el idioma de los handlers.
  // Pasaban porque uiLang() caía por el require perezoso muerto a
  // su defecto duro «es»; con el módulo i18n del núcleo vivo
  // (I18N-2), uiLang() lee el idioma del módulo, que en el banco
  // nace en el del dispositivo, y los textos salen en ese idioma.
  // Los cuatro fijan ahora setHandlerLangForTest("es") por caso,
  // con la misma forma de las reconciliaciones de handlersFaseE,
  // y este afterEach restaura la fijación tras cada caso.
  afterEach(() => {
    setHandlerLangForTest(null);
  });

  it("create_calendar_event cancelado no toca el calendario", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => false });
    const out = await h["create_calendar_event"]({ title: "X", start: "2026-09-28T10:00:00" });
    expect(out).toMatch(/I did nothing/i);
  });

  it("create_calendar_event confirmado pasa la puerta y llega al handler", async () => {
    // E7 paso 2: el handler es el calendario real de NIDO. Con la
    // puerta aprobada y una base cifrada temporal, llegar al
    // handler = el evento queda creado en la base.
    // I18N-2: el caso cobra «Evento creado» (L() en español);
    // fija el idioma expresamente (causa en la cabecera del
    // describe).
    setHandlerLangForTest("es");
    const dir = mkdtempSync(join(tmpdir(), "nido-confirm-cal-"));
    setAppStoreDir(dir);
    setAppStoreDekProvider(() => Buffer.from(randomBytes(32)));
    try {
      const h = buildToolHandlers({ requestConfirm: async () => true });
      const out = await h["create_calendar_event"]({ title: "X", start: "2026-09-28T10:00:00" });
      expect(out).toContain("Evento creado");
      const day = await listEvents(
        new Date("2026-09-28T00:00:00").getTime(),
        new Date("2026-09-29T00:00:00").getTime(),
      );
      expect(day.map((e) => e.title)).toEqual(["X"]);
    } finally {
      await closeDatabase();
      setAppStoreDekProvider(null);
      setAppStoreDir(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("0.1.25: el diálogo de crear evento muestra la fecha legible, no el ISO crudo", async () => {
    // Nota física (Tab A9+, 2026-10-12): el diálogo decía
    // «2026-10-16T17:00:00.000Z» en vez de la fecha local.
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    await h["create_calendar_event"]({ title: "dentist", start: "2026-10-16T17:00:00.000Z" });
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("dentist");
    expect(seen[0].message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(seen[0].message).toMatch(/\d{1,2}:\d{2}/);
  });

  // D11S-1: con la costura de notificaciones real (devuelve false), el
  // aviso del recordatorio es el de memoria, nunca el del sistema.
  // Planta P-NOT: scheduleReminderNotification devuelve true → caen el
  // segundo y el tercer expect. La fecha es calculada (+24 h): el
  // handler rechaza fechas pasadas y una fecha literal pudriría el caso.
  it("create_reminder con fecha futura y la costura real: el aviso es el de memoria, nunca el del sistema", async () => {
    // Desde la cura H-01 el almacén es el persistente: el caso
    // monta su base temporal con su DEK, como el de calendario
    // de arriba. Sin residente en el banco, osNoticeWillFire es
    // falso y la letra sigue siendo la de memoria.
    // I18N-2: el caso cobra «Recordatorio guardado» y el aviso en
    // español (L()); fija el idioma expresamente (causa en la
    // cabecera del describe).
    setHandlerLangForTest("es");
    const dir = mkdtempSync(join(tmpdir(), "nido-confirm-rem-"));
    setAppStoreDir(dir);
    setAppStoreDekProvider(() => Buffer.from(randomBytes(32)));
    try {
      const h = buildToolHandlers({ requestConfirm: async () => true });
      const at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const out = await h["create_reminder"]({ text: "pagar la luz", at });
      expect(out).toContain("Recordatorio guardado");
      expect(out).toContain("Te avisaré al abrir NIDO cuando llegue la hora.");
      expect(out).not.toContain("Te llegará un aviso del sistema");
    } finally {
      await closeDatabase();
      setAppStoreDekProvider(null);
      setAppStoreDir(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nido_send_message cancelado no envía nada", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => false });
    const out = await h["nido_send_message"]({ to: "Beto", text: "hola" });
    expect(out).toMatch(/I did nothing/i);
  });

  // D11S-1 (cura del H-1 de AUDITORIA-11-SUPERFICIE.md, tanda 14 paso
  // primero): el mensajero real no se mockea en esta batería; con la
  // confirmación concedida, el handler toma la rama de la cola de
  // salida y nunca dice «enviado». Planta P-MSG: sendChat devuelve
  // queued: false → este caso cae.
  // Δ-1 (tanda del mensajero Fase E, con la cura de F-PC68): el caso
  // se re-asienta emparejando a «Beto» antes de enviar, porque el
  // handler curado ya no acepta destinatarios sin emparejar, y
  // afirma el texto verdadero de la cola; la planta no cambia.
  it("nido_send_message confirmado con el mensajero real: queda en la cola de salida, nunca «enviado»", async () => {
    // I18N-2: el caso cobra el texto de la cola en español (L());
    // fija el idioma expresamente (causa en la cabecera del
    // describe).
    setHandlerLangForTest("es");
    const { generateIdentity } = await import("../../p2p/crypto.js");
    const { encodePairingPayload } = await import("../../p2p/pairing.js");
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const betoId = generateIdentity();
    const betoSign = generateIdentity();
    await h["nido_pair"]({
      code: encodePairingPayload("Beto", betoId.publicKey, betoSign.publicKey),
    });
    const out = await h["nido_send_message"]({ to: "Beto", text: "hola Beto" });
    expect(out).toBe(
      "Mensaje para «Beto» guardado en la cola de salida de esta sesión, sin cifrar. Se queda ahí mientras la app esté abierta: en PC todavía no hay transporte NIDO a NIDO que lo entregue.",
    );
  });

  it("nido_pair cancelado no empareja a nadie", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => false });
    const out = await h["nido_pair"]({ code: "NIDO1:{}" });
    expect(out).toMatch(/I did nothing/i);
  });

  it("nido_pair muestra nombre + huella en el diálogo antes de emparejar", async () => {
    const { generateIdentity } = await import("../../p2p/crypto.js");
    const { encodePairingPayload } = await import("../../p2p/pairing.js");
    const id = generateIdentity();
    const sign = generateIdentity();
    const code = encodePairingPayload("Beto", id.publicKey, sign.publicKey);
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    const out = await h["nido_pair"]({ code });
    expect(out).toMatch(/I did nothing/i);
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toContain("Beto");
    // La huella va en el formato de 8 grupos hex que el otro NIDO muestra
    // en persona para cotejo verbal (independiente del idioma del diálogo).
    expect(seen[0].message).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
  });

  it("nido_pair con QR inválido avisa sin emparejar", async () => {
    const seen: Array<{ title: string; message: string }> = [];
    const h = buildToolHandlers({
      requestConfirm: async (req) => {
        seen.push(req);
        return false;
      },
    });
    const out = await h["nido_pair"]({ code: "esto-no-es-un-qr" });
    expect(out).toMatch(/I did nothing/i);
    expect(seen).toHaveLength(1);
    expect(seen[0].message).not.toContain("Beto");
  });

  // D11S-1: la bandeja real está vacía por construcción; decidir sobre
  // un id inexistente produce el texto de no encontrada, nunca una
  // decisión fabricada. Planta P-APR: approveAgentTask devuelve true
  // con el id ausente → el primer caso cae; su forma gemela sobre
  // rejectAgentTask → el segundo cae.
  it("nido_approve_task confirmado sobre un id inexistente: la bandeja real no fabrica una aprobación", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["nido_approve_task"]({ id: "tarea-fantasma" });
    expect(out).toBe(
      "There is no pending task with id “tarea-fantasma” (it may already have been decided).",
    );
  });

  it("nido_reject_task confirmado sobre un id inexistente: la bandeja real no fabrica un rechazo", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const out = await h["nido_reject_task"]({ id: "tarea-fantasma" });
    expect(out).toBe(
      "There is no pending task with id “tarea-fantasma” (it may already have been decided).",
    );
  });

  it("M-3: sin requestConfirm, NINGUNA herramienta sensible se ejecuta", async () => {
    const h = buildToolHandlers(); // sin canal de confirmación
    const args = {
      title: "X",
      start: "2026-09-28T10:00:00",
      to: "Beto",
      text: "hola",
      code: "NIDO1:{}",
      link: "https://nido.example/x",
    };
    for (const tool of [
      "create_calendar_event",
      "nido_send_message",
      "nido_pair",
      "nido_approve_task",
      "nido_reject_task",
    ]) {
      const out = await h[tool](args);
      // El texto es EXACTAMENTE el bloqueo M-3: ningún handler produjo su
      // propio resultado (ni éxito ni su error interno) → no se ejecutó.
      expect(out).toBe(confirmBlockedMessage(tool));
    }
  });

  // D11S-1: el registro sirve exactamente las cuatro built-in, por
  // nombre y en su orden, y el handler sin nombre anuncia exactamente
  // ese listado. El oráculo es la enumeración literal de builtIn.ts.
  // Planta P-SKILL: listSkills añade una skill «Fantasma» → caen las
  // dos aserciones.
  it("use_skill sin nombre lista exactamente las built-in, por nombre (ninguna skill fingida)", async () => {
    // I18N-2: el caso cobra «Indica el nombre de la skill…» (L()
    // en español); fija el idioma expresamente (causa en la
    // cabecera del describe).
    setHandlerLangForTest("es");
    const { listSkills } = await import("../skills/registry.js");
    expect(listSkills().map((s) => s.name)).toEqual([
      "analiza-datos",
      "planifica-mi-dia",
      "planifica-mi-semana",
      "resume-archivo",
    ]);
    const h = buildToolHandlers();
    const out = await h["use_skill"]({});
    expect(out).toBe(
      "Indica el nombre de la skill. Disponibles: analiza-datos, planifica-mi-dia, planifica-mi-semana, resume-archivo.",
    );
  });
});
