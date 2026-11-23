/**
 * handlersFaseE.test.ts — batería de la superficie del agente del
 * mensajero (F-PC68, F-PC72 y la superficie de F-PC69; tanda del
 * mensajero Fase E de la serie de curas, especificación en
 * estudios/FPC68-73-CURA-PREP.md §3.2).
 *
 * Contra buildToolHandlers con el canal de confirmación
 * inyectado y el idioma de los handlers fijado por
 * setHandlerLangForTest, en la forma de la batería de paridad de
 * handlers de la casa, más la lectura de las descripciones del
 * manifiesto desde su módulo.
 *
 * Ejecución declarada de los diálogos en esta casa:
 * reconciliación I18N-2 (con su causa). Esta cabecera declaraba
 * que el módulo i18n no se resolvía en el banco y que
 * agentConfirmT servía siempre la tabla de reserva en inglés;
 * esa era la forma del hueco, no el diseño. Con el módulo del
 * núcleo creado y resuelto por import estático (I18N-2), los
 * casos de diálogo fijan el idioma del módulo expresamente
 * (changeLanguage) y el asiento en inglés se cobra servido por
 * el handler a través del canal de confirmación capturado, por
 * el módulo vivo y no por la reserva. Los casos cobran por
 * tanto los cuatro asientos así: los tres locales se leen de
 * sus JSON con la interpolación aplicada, y el asiento en
 * inglés se cobra además servido. Los dos controles que cobran
 * textos por L() sin fijar idioma (nido_read_inbox,
 * nido_my_code) salían en español del defecto «es» de la
 * cadena muerta en uiLang; ahora fijan el idioma de los
 * handlers expresamente, como el resto de la batería.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildToolHandlers, setHandlerLangForTest } from "./handlers.js";
import { LOCAL_TOOLS } from "./manifest.js";
import { getSharedNidoMessenger } from "../../services/nidoMessenger.js";
import { fingerprint, generateIdentity, generateSigningKeypair } from "../../p2p/crypto.js";
import { encodePairingPayload } from "../../p2p/pairing.js";
import esJson from "../../i18n/locales/es.json" with { type: "json" };
import enJson from "../../i18n/locales/en.json" with { type: "json" };
import ptJson from "../../i18n/locales/pt.json" with { type: "json" };
import i18n from "../../i18n/index.js";
import { deviceDefaultLanguage } from "../../models/settings.js";

type Req = { title: string; message: string };

const H = (capture?: Req[], confirm = true) =>
  buildToolHandlers({
    requestConfirm: async (req) => {
      capture?.push(req as Req);
      return confirm;
    },
  });

afterEach(() => {
  setHandlerLangForTest(null);
  i18n.changeLanguage(deviceDefaultLanguage());
});

function codeFor(name: string): { code: string; fp: string } {
  const id = generateIdentity();
  const sign = generateSigningKeypair();
  return {
    code: encodePairingPayload(name, id.publicKey, sign.publicKey),
    fp: fingerprint(id.publicKey, sign.publicKey),
  };
}

async function pairOk(h: ReturnType<typeof H>, name: string): Promise<void> {
  const { code } = codeFor(name);
  await h["nido_pair"]({ code });
}

/** Lee un asiento agentConfirm.* de un locale con la interpolación aplicada. */
function seat(json: unknown, key: string, vars: Record<string, string>): string {
  let s = (json as { agentConfirm: Record<string, string> }).agentConfirm[key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}

function toolDef(name: string) {
  const t = LOCAL_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`herramienta ausente en el manifiesto: ${name}`);
  return t;
}

const FP = "0123 4567 89ab cdef 0123 4567 89ab cdef";

describe("F-PC68 · el texto del envío y sus asientos", () => {
  it("enviar a un contacto emparejado (es): el texto verdadero de la cola, sin cifrado ni promesa de entrega", async () => {
    const h = H();
    await pairOk(h, "Beto");
    setHandlerLangForTest("es");
    const out = await h["nido_send_message"]({ to: "Beto", text: "hola Beto" });
    expect(out).toBe(
      "Mensaje para «Beto» guardado en la cola de salida de esta sesión, sin cifrar. Se queda ahí mientras la app esté abierta: en PC todavía no hay transporte NIDO a NIDO que lo entregue.",
    );
  });

  it("enviar a un nombre sin contacto emparejado (es): el rechazo verdadero, que nombra que nada se guardó", async () => {
    const h = H();
    setHandlerLangForTest("es");
    const out = await h["nido_send_message"]({ to: "Nadie F68", text: "hola" });
    expect(out).toBe(
      "No tienes ningún contacto NIDO emparejado con el nombre «Nadie F68», así que no he guardado el mensaje. Empareja primero el código de esa persona y vuelve a intentarlo.",
    );
  });

  it("el mismo envío emparejado, en inglés: el texto verdadero por L()", async () => {
    const h = H();
    await pairOk(h, "Emma F68");
    setHandlerLangForTest("en");
    const out = await h["nido_send_message"]({ to: "Emma F68", text: "hello" });
    expect(out).toBe(
      "Message for “Emma F68” saved in this session's outbox, unencrypted. It stays there while the app is open: on PC there is no NIDO-to-NIDO transport yet to deliver it.",
    );
  });

  it("el mismo envío emparejado, en portugués: el texto verdadero por L()", async () => {
    const h = H();
    await pairOk(h, "Rui F68");
    setHandlerLangForTest("pt");
    const out = await h["nido_send_message"]({ to: "Rui F68", text: "olá" });
    expect(out).toBe(
      "Mensagem para “Rui F68” salva na fila de saída desta sessão, sem criptografia. Ela fica ali enquanto o app estiver aberto: no PC ainda não há transporte NIDO a NIDO que a entregue.",
    );
  });

  it("el diálogo de confirmación de nido_send_message (es): guardar en la cola, sin cifrar", () => {
    expect(seat(esJson, "sendMessageMessage", { to: "Beto", text: "hola Beto" })).toBe(
      "¿Guardar un mensaje para «Beto» en la cola de salida de esta sesión (sin cifrar)?\n\n«hola Beto»",
    );
  });

  it("el diálogo, en inglés: la forma curada en el locale y servida por el handler (el módulo fijado en inglés)", async () => {
    expect(seat(enJson, "sendMessageMessage", { to: "Beto", text: "hola Beto" })).toBe(
      "Save a message for “Beto” in this session's outbox (unencrypted)?\n\n“hola Beto”",
    );
    i18n.changeLanguage("en");
    const capture: Req[] = [];
    const h = H(capture);
    await h["nido_send_message"]({ to: "Beto", text: "hola Beto" });
    expect(capture).toHaveLength(1);
    expect(capture[0].message).toBe(
      "Save a message for “Beto” in this session's outbox (unencrypted)?\n\n“hola Beto”",
    );
  });

  it("el diálogo, en portugués: la forma curada", () => {
    expect(seat(ptJson, "sendMessageMessage", { to: "Beto", text: "hola Beto" })).toBe(
      "Salvar uma mensagem para “Beto” na fila de saída desta sessão (sem criptografia)?\n\n“hola Beto”",
    );
  });

  it("la descripción de nido_send_message en el manifiesto: sin Bluetooth, sin cifrado, con el rechazo nombrado", () => {
    expect(toolDef("nido_send_message").description).toBe(
      "Guarda un mensaje para un contacto NIDO ya emparejado en la cola de salida de esta sesión, sin cifrar. En PC todavía no hay transporte NIDO a NIDO: el mensaje no se entrega solo y se pierde al cerrar la app. Si el nombre no es de un contacto emparejado, la herramienta no guarda nada y lo dice.",
    );
  });

  it("la descripción de nido_read_inbox en el manifiesto: la bandeja vacía nombrada", () => {
    expect(toolDef("nido_read_inbox").description).toBe(
      "Lee los mensajes NIDO recibidos que aún no se han leído. En PC la bandeja está siempre vacía en esta etapa: todavía no hay transporte que reciba mensajes.",
    );
  });
});

describe("F-PC72 · los textos del emparejamiento", () => {
  it("el resultado de nido_pair sin reemplazo (es): sin mensajería cifrada y sin la pantalla inexistente", async () => {
    const h = H();
    setHandlerLangForTest("es");
    const { code } = codeFor("Lía F72");
    const out = await h["nido_pair"]({ code });
    expect(out).toBe(
      "Contacto «Lía F72» emparejado, sin verificar todavía. Queda en tu lista de contactos de esta sesión. Para verificarlo, comparen la huella en persona.",
    );
  });

  it("el resultado de nido_pair con replace (es): la identidad sale de la lista y la cola queda bajo el nombre", async () => {
    const h = H();
    setHandlerLangForTest("es");
    await pairOk(h, "Relevo F72");
    const { code } = codeFor("Relevo F72");
    const out = await h["nido_pair"]({ code, disambiguation: "replace" });
    expect(out).toBe(
      "Contacto «Relevo F72» emparejado, sin verificar todavía. Queda en tu lista de contactos de esta sesión. Para verificarlo, comparen la huella en persona. La identidad anterior salió de tu lista de contactos. Los mensajes que tuvieras en la cola de salida para el nombre «Relevo F72» siguen en la cola bajo ese nombre.",
    );
  });

  it("el diálogo pairReplaceConfirmMessage (es): la forma curada", () => {
    expect(seat(esJson, "pairReplaceConfirmMessage", { name: "Beto", fingerprint: FP })).toBe(
      "¿REEMPLAZAR la identidad de «Beto»?\nHuella: " +
        FP +
        "\n\nEsto retira la identidad anterior de tu lista de contactos de esta sesión. Los mensajes que tuvieras en la cola de salida para este nombre se quedan en la cola bajo el mismo nombre. No se puede deshacer. Confirma solo si verificaste este código en persona.",
    );
  });

  it("el diálogo, en inglés: la forma curada en el locale y servida por el handler (el módulo fijado en inglés)", async () => {
    const cured =
      "REPLACE the identity of “Beto”?\nFingerprint: " +
      FP +
      "\n\nThis removes the old identity from this session's contact list. Any messages you had in the outbox for this name stay in the outbox under the same name. This cannot be undone. Confirm only if you verified this code in person.";
    expect(seat(enJson, "pairReplaceConfirmMessage", { name: "Beto", fingerprint: FP })).toBe(cured);
    i18n.changeLanguage("en");
    const h = H();
    await pairOk(h, "Cambio F72");
    const capture: Req[] = [];
    const h2 = H(capture);
    const { code, fp } = codeFor("Cambio F72");
    await h2["nido_pair"]({ code, disambiguation: "replace" });
    expect(capture).toHaveLength(1);
    expect(capture[0].message).toContain(
      "REPLACE the identity of “Cambio F72”?\nFingerprint: " +
        fp +
        "\n\nThis removes the old identity from this session's contact list. Any messages you had in the outbox for this name stay in the outbox under the same name. This cannot be undone. Confirm only if you verified this code in person.",
    );
  });

  it("el diálogo, en portugués: la forma curada", () => {
    expect(seat(ptJson, "pairReplaceConfirmMessage", { name: "Beto", fingerprint: FP })).toBe(
      "SUBSTITUIR a identidade de “Beto”?\nImpressão digital: " +
        FP +
        "\n\nIsso retira a identidade anterior da sua lista de contatos desta sessão. As mensagens que você tinha na fila de saída para este nome continuam na fila com o mesmo nome. Não pode ser desfeito. Confirme apenas se você verificou este código pessoalmente.",
    );
  });

  it("la viñeta de replace en pairAmbiguousAsk (es): «de tu lista de contactos»", () => {
    const s = seat(esJson, "pairAmbiguousAsk", {
      name: "Beto",
      fingerprint: FP,
      count: "1",
      candidates: "«Beto»",
    });
    expect(s).toContain("retira la identidad anterior de tu lista de contactos (destructivo)");
    expect(s).not.toContain("en todas partes");
  });

  it("la viñeta, en inglés: «from your contact list», en el locale y servida por el handler (el módulo fijado en inglés)", async () => {
    const s = seat(enJson, "pairAmbiguousAsk", {
      name: "Beto",
      fingerprint: FP,
      count: "1",
      candidates: "“Beto”",
    });
    expect(s).toContain("removes the old identity from your contact list (destructive)");
    expect(s).not.toContain("everywhere");
    i18n.changeLanguage("en");
    const h = H();
    await pairOk(h, "Duda F72");
    const capture: Req[] = [];
    const h2 = H(capture);
    const { code } = codeFor("Duda F72");
    await h2["nido_pair"]({ code });
    expect(capture).toHaveLength(1);
    expect(capture[0].message).toContain("removes the old identity from your contact list (destructive)");
    expect(capture[0].message).not.toContain("everywhere");
  });

  it("la viñeta, en portugués: «da sua lista de contatos»", () => {
    const s = seat(ptJson, "pairAmbiguousAsk", {
      name: "Beto",
      fingerprint: FP,
      count: "1",
      candidates: "“Beto”",
    });
    expect(s).toContain("retira a identidade anterior da sua lista de contatos (destrutivo)");
    expect(s).not.toContain("EM TODOS OS LUGARES");
  });

  it("la cláusula de replace en el manifiesto de nido_pair: «de la lista de contactos»", () => {
    const d = toolDef("nido_pair").parameters["disambiguation"].description ?? "";
    expect(d).toContain(
      "retira la identidad vieja de la lista de contactos (destructivo, pide confirmación explícita al usuario)",
    );
    expect(d).not.toContain("TODAS partes");
  });
});

describe("F-PC69 · la superficie del agente", () => {
  it("nido_pair con el propio código servido por nido_my_code: sirve el rechazo del propio QR y no escribe ningún contacto", async () => {
    const h = H();
    setHandlerLangForTest("es");
    const mine = await h["nido_my_code"]({});
    const code = /NIDO1:\S+/.exec(mine)?.[0];
    expect(code).toBeTruthy();
    const out = await h["nido_pair"]({ code: code! });
    expect(out).toBe("No pude emparejar: Ese es tu propio QR.");
    const m = getSharedNidoMessenger();
    expect((await m.contacts()).filter((c) => c.name === "NIDO")).toHaveLength(0);
  });
});

describe("controles", () => {
  it("nido_read_inbox sin mensajes: su verdad de hoy", async () => {
    // I18N-2: el idioma se fija expresamente; antes salía en
    // español del defecto «es» de la cadena muerta en uiLang.
    setHandlerLangForTest("es");
    const h = H();
    const out = await h["nido_read_inbox"]({});
    expect(out).toBe("No tienes mensajes NIDO sin leer.");
  });

  it("nido_pair cancelado por el usuario: el texto de cancelación, sin efectos", async () => {
    // I18N-2: el texto de cancelación lo sirve el núcleo de
    // confirmación en el idioma del módulo, fijado expresamente;
    // antes lo servía la tabla de reserva por la cadena muerta.
    i18n.changeLanguage("en");
    const h = H(undefined, false);
    const { code } = codeFor("Cancelada F72");
    const out = await h["nido_pair"]({ code });
    expect(out).toBe("Understood, I did nothing.");
    const m = getSharedNidoMessenger();
    expect((await m.contacts()).filter((c) => c.name === "Cancelada F72")).toHaveLength(0);
  });

  it("nido_my_code: la cabecera y la huella, sin promesa añadida", async () => {
    // I18N-2: el idioma se fija expresamente; antes salía en
    // español del defecto «es» de la cadena muerta en uiLang.
    setHandlerLangForTest("es");
    const h = H();
    const out = await h["nido_my_code"]({});
    expect(out).toContain("Tu código de emparejamiento NIDO");
    expect(out).toContain("Huella para verificar en persona:");
    expect(out).not.toContain("cifrados");
  });
});
