/**
 * nidoMessengerFaseE.test.ts — batería de la vía de escritura del
 * mensajero (F-PC69, F-PC70, F-PC71 y F-PC73; tanda del mensajero
 * Fase E de la serie de curas, especificación en
 * estudios/FPC68-73-CURA-PREP.md §3.1).
 *
 * Contra InMemoryNidoMessenger a través de getSharedNidoMessenger
 * (instancia aislada por fichero, en la forma de la casa); cada
 * caso dispone su propio estado con nombres únicos, así que
 * ningún caso depende del orden. Las clases de error que la cura
 * introduce (SelfPairingError, PairingNameError,
 * PairingKeyChangedError, InvalidPairingChoiceError) se afirman
 * por su nombre y por su existencia como exportación del módulo:
 * al nacer no existen, y ese es parte de su rojo.
 *
 * Precisión de montaje declarada para los casos 16 y 17 de
 * F-PC71: su estado (dos contactos vivos con el mismo nombre
 * normalizado) es inalcanzable por la vía pública con la cura de
 * F-PC70 en pie, porque esa cura existe para impedirlo; la fila
 * que nunca se mostró se coloca directamente en la lista del
 * mensajero para ejercitar el contrato de conjunto de F-PC71,
 * que es un contrato del módulo y no depende de cómo la fila
 * llegó. Las aserciones de los dos casos son las de la
 * especificación, sin cambio.
 */
import { describe, it, expect } from "vitest";
import * as messengerModule from "./nidoMessenger.js";
import {
  getSharedNidoMessenger,
  PairingDisambiguationRequiredError,
  StaleReplaceConflictError,
  type NidoContactLike,
} from "./nidoMessenger.js";
import { fromHex, generateIdentity, generateSigningKeypair, toHex } from "../p2p/crypto.js";
import { decodePairingPayload, encodePairingPayload } from "../p2p/pairing.js";
import type { PairDisambiguation } from "../p2p/pairingCeremony.js";

const m = getSharedNidoMessenger();

function codeV2(name: string, id = generateIdentity(), sign = generateSigningKeypair()): string {
  return encodePairingPayload(name, id.publicKey, sign.publicKey);
}

function codeV1(name: string, id = generateIdentity()): string {
  return "NIDO1:" + JSON.stringify({ v: 1, app: "nido", name, pk: toHex(id.publicKey) });
}

function pkOf(code: string): string {
  return decodePairingPayload(code).pk;
}

async function contactsNamed(name: string): Promise<NidoContactLike[]> {
  return (await m.contacts()).filter((c) => c.name === name);
}

async function contactByPk(pkHex: string): Promise<NidoContactLike | undefined> {
  return (await m.contacts()).find((c) => c.pkHex.toLowerCase() === pkHex.toLowerCase());
}

/** La clase de error de la cura existe como exportación y el rechazo la trae por nombre. */
async function expectCureReject(p: Promise<unknown>, className: string): Promise<void> {
  expect((messengerModule as Record<string, unknown>)[className]).toBeTypeOf("function");
  await expect(p).rejects.toMatchObject({ name: className });
}

/** Coloca una fila de contacto directamente (ver la precisión de montaje de la cabecera). */
function placeContactRow(row: NidoContactLike): void {
  const list = (m as unknown as { contactList: NidoContactLike[] }).contactList;
  list.push(row);
}

describe("F-PC69 · pairWith rechaza el propio QR", () => {
  it("el propio código de myPairingCode lanza SelfPairingError y no escribe", async () => {
    const selfCode = await m.myPairingCode();
    const selfPk = pkOf(selfCode);
    await expectCureReject(m.pairWith(selfCode), "SelfPairingError");
    expect(await contactByPk(selfPk)).toBeUndefined();
  });

  it("el propio QR recodificado con otro nombre visible también se rechaza (la comparación es por pk)", async () => {
    const selfCode = await m.myPairingCode();
    const payload = decodePairingPayload(selfCode);
    const recoded = encodePairingPayload(
      "Otro Nombre F69",
      fromHex(payload.pk),
      fromHex(payload.spk!),
    );
    await expectCureReject(m.pairWith(recoded), "SelfPairingError");
    expect(await contactsNamed("Otro Nombre F69")).toHaveLength(0);
    expect(await contactByPk(payload.pk)).toBeUndefined();
  });

  it("control: el código de otro empareja y devuelve su nombre", async () => {
    const code = codeV2("Control F69");
    const out = await m.pairWith(code);
    expect(out).toEqual({ name: "Control F69" });
    expect(await contactByPk(pkOf(code))).toBeDefined();
  });
});

describe("F-PC70 · pairWith valida la elección y el nombre nuevo antes de escribir", () => {
  it("different_person sin newName, con colisión: PairingNameError y no hay duplicado", async () => {
    await m.pairWith(codeV2("Base F70a"));
    const incoming = codeV2("Base F70a");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "different_person" }),
      "PairingNameError",
    );
    expect(await contactsNamed("Base F70a")).toHaveLength(1);
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("different_person con newName con U+202E: PairingNameError y nada se guarda con ese carácter", async () => {
    await m.pairWith(codeV2("Base F70b"));
    const incoming = codeV2("Base F70b");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "different_person", newName: "Nuevo\u202E F70" }),
      "PairingNameError",
    );
    const all = await m.contacts();
    expect(all.some((c) => c.name.includes("\u202E"))).toBe(false);
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("newName que normaliza al nombre en colisión: PairingNameError", async () => {
    await m.pairWith(codeV2("Base F70c"));
    const incoming = codeV2("Base F70c");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "different_person", newName: "  BASE F70C " }),
      "PairingNameError",
    );
    expect(await contactsNamed("Base F70c")).toHaveLength(1);
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("newName que normaliza al nombre de un tercer contacto: PairingNameError (la unicidad es contra la lista entera)", async () => {
    await m.pairWith(codeV2("Tercero F70"));
    await m.pairWith(codeV2("Base F70d"));
    const incoming = codeV2("Base F70d");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "different_person", newName: " tercero f70 " }),
      "PairingNameError",
    );
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
    expect(await contactsNamed("Tercero F70")).toHaveLength(1);
  });

  it("newName de solo caracteres de ancho cero: PairingNameError", async () => {
    await m.pairWith(codeV2("Base F70e"));
    const incoming = codeV2("Base F70e");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "different_person", newName: "\u200B\u200C\u200F" }),
      "PairingNameError",
    );
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("newName de 200 caracteres, sin colisión alguna: PairingNameError (la entrada no tiene ni el tope de 40)", async () => {
    const incoming = codeV2("Base F70f");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "different_person", newName: "L".repeat(200) }),
      "PairingNameError",
    );
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("valor de desambiguación desconocido, con colisión: InvalidPairingChoiceError y no se escribe", async () => {
    await m.pairWith(codeV2("Base F70g"));
    const incoming = codeV2("Base F70g");
    await expectCureReject(
      m.pairWith(incoming, { disambiguation: "bogus" as PairDisambiguation }),
      "InvalidPairingChoiceError",
    );
    expect(await contactsNamed("Base F70g")).toHaveLength(1);
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("renombrar un existente vía different_person con newName inseguro: PairingNameError y el nombre guardado no cambia", async () => {
    const own = codeV2("Base F70h");
    await m.pairWith(own);
    await expectCureReject(
      m.pairWith(own, { disambiguation: "different_person", newName: "Mal\u202E F70" }),
      "PairingNameError",
    );
    expect((await contactByPk(pkOf(own)))?.name).toBe("Base F70h");
  });

  it("control: different_person con nombre seguro y único, con colisión, guarda con ese nombre", async () => {
    await m.pairWith(codeV2("Base F70i"));
    const incoming = codeV2("Base F70i");
    const out = await m.pairWith(incoming, {
      disambiguation: "different_person",
      newName: "Unico F70i",
    });
    expect(out).toEqual({ name: "Unico F70i" });
    expect((await contactByPk(pkOf(incoming)))?.name).toBe("Unico F70i");
  });

  it("control: different_person con nombre seguro y único, sin colisión, guarda con ese nombre", async () => {
    const incoming = codeV2("Base F70j");
    const out = await m.pairWith(incoming, {
      disambiguation: "different_person",
      newName: "Unico F70j",
    });
    expect(out).toEqual({ name: "Unico F70j" });
    expect((await contactByPk(pkOf(incoming)))?.name).toBe("Unico F70j");
  });

  it("control gobernado: sin elección, con colisión, lanza PairingDisambiguationRequiredError", async () => {
    await m.pairWith(codeV2("Base F70k"));
    const incoming = codeV2("Base F70k");
    await expect(m.pairWith(incoming)).rejects.toThrowError(PairingDisambiguationRequiredError);
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("control gobernado: cancel, con colisión, devuelve null y no escribe", async () => {
    await m.pairWith(codeV2("Base F70l"));
    const incoming = codeV2("Base F70l");
    const out = await m.pairWith(incoming, { disambiguation: "cancel" });
    expect(out).toBeNull();
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });
});

describe("F-PC71 · el replace retira exactamente el conjunto confirmado", () => {
  it("objetivos [A] y una identidad B nunca mostrada con el mismo nombre: StaleReplaceConflictError y nada cambia", async () => {
    const a = codeV2("Grupo F71a");
    await m.pairWith(a);
    const bId = generateIdentity();
    const bSign = generateSigningKeypair();
    placeContactRow({ pkHex: toHex(bId.publicKey), name: "Grupo F71a", sigPkHex: toHex(bSign.publicKey) });
    const incoming = codeV2("Grupo F71a");
    await expect(
      m.pairWith(incoming, { disambiguation: "replace", replaceTargets: [pkOf(a)] }),
    ).rejects.toThrowError(StaleReplaceConflictError);
    expect(await contactByPk(pkOf(a))).toBeDefined();
    expect(await contactByPk(toHex(bId.publicKey))).toBeDefined();
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
    expect(await contactsNamed("Grupo F71a")).toHaveLength(2);
  });

  it("el objetivo B cambió de nombre entre la ceremonia y la escritura: StaleReplaceConflictError y nada se escribe", async () => {
    const a = codeV2("Grupo F71b");
    await m.pairWith(a);
    const bId = generateIdentity();
    const bSign = generateSigningKeypair();
    placeContactRow({ pkHex: toHex(bId.publicKey), name: "Grupo F71b", sigPkHex: toHex(bSign.publicKey) });
    const bRenamed = codeV2("Roberto F71b", bId, bSign);
    await m.pairWith(bRenamed);
    expect((await contactByPk(toHex(bId.publicKey)))?.name).toBe("Roberto F71b");
    const incoming = codeV2("Grupo F71b");
    await expect(
      m.pairWith(incoming, {
        disambiguation: "replace",
        replaceTargets: [pkOf(a), toHex(bId.publicKey)],
      }),
    ).rejects.toThrowError(StaleReplaceConflictError);
    expect(await contactByPk(pkOf(a))).toBeDefined();
    expect((await contactByPk(toHex(bId.publicKey)))?.name).toBe("Roberto F71b");
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("replace sin replaceTargets: StaleReplaceConflictError y nada se escribe", async () => {
    const a = codeV2("Grupo F71c");
    await m.pairWith(a);
    const incoming = codeV2("Grupo F71c");
    await expect(
      m.pairWith(incoming, { disambiguation: "replace" }),
    ).rejects.toThrowError(StaleReplaceConflictError);
    expect(await contactByPk(pkOf(a))).toBeDefined();
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("control gobernado: un objetivo ya no vivo lanza StaleReplaceConflictError", async () => {
    const a = codeV2("Grupo F71d");
    await m.pairWith(a);
    const deadPk = toHex(generateIdentity().publicKey);
    const incoming = codeV2("Grupo F71d");
    await expect(
      m.pairWith(incoming, { disambiguation: "replace", replaceTargets: [deadPk] }),
    ).rejects.toThrowError(StaleReplaceConflictError);
    expect(await contactByPk(pkOf(a))).toBeDefined();
    expect(await contactByPk(pkOf(incoming))).toBeUndefined();
  });

  it("control: replace con el conjunto exacto confirmado retira exactamente esos y empareja el nuevo", async () => {
    const a = codeV2("Grupo F71e");
    await m.pairWith(a);
    const incoming = codeV2("Grupo F71e");
    const out = await m.pairWith(incoming, {
      disambiguation: "replace",
      replaceTargets: [pkOf(a)],
    });
    expect(out).toEqual({ name: "Grupo F71e" });
    expect(await contactByPk(pkOf(a))).toBeUndefined();
    expect(await contactByPk(pkOf(incoming))).toBeDefined();
    expect(await contactsNamed("Grupo F71e")).toHaveLength(1);
  });
});

describe("F-PC73 · una clave de firma distinta para una pk conocida falla cerrado", () => {
  it("misma pk, otra clave de firma (v2 → v2′): PairingKeyChangedError y el registro queda el mismo", async () => {
    const id = generateIdentity();
    const sign1 = generateSigningKeypair();
    const sign2 = generateSigningKeypair();
    await m.pairWith(codeV2("Clave F73a", id, sign1));
    await expectCureReject(m.pairWith(codeV2("Clave F73a", id, sign2)), "PairingKeyChangedError");
    const row = await contactByPk(toHex(id.publicKey));
    expect(row?.sigPkHex).toBe(toHex(sign1.publicKey));
    expect(row?.name).toBe("Clave F73a");
  });

  it("v1 guardado, v2 presentado con la misma pk: PairingKeyChangedError y sigPkHex sigue null", async () => {
    const id = generateIdentity();
    await m.pairWith(codeV1("Clave F73b", id));
    expect((await contactByPk(toHex(id.publicKey)))?.sigPkHex).toBeNull();
    await expectCureReject(m.pairWith(codeV2("Clave F73b", id)), "PairingKeyChangedError");
    expect((await contactByPk(toHex(id.publicKey)))?.sigPkHex).toBeNull();
  });

  it("v2 guardado, v1 presentado con la misma pk: PairingKeyChangedError y sigPkHex no cambia", async () => {
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    await m.pairWith(codeV2("Clave F73c", id, sign));
    await expectCureReject(m.pairWith(codeV1("Clave F73c", id)), "PairingKeyChangedError");
    expect((await contactByPk(toHex(id.publicKey)))?.sigPkHex).toBe(toHex(sign.publicKey));
  });

  it("control: re-presentación idéntica con otro nombre en el payload renombra y devuelve éxito", async () => {
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    await m.pairWith(codeV2("Clave F73d", id, sign));
    const out = await m.pairWith(codeV2("Renombrada F73d", id, sign));
    expect(out).toEqual({ name: "Renombrada F73d" });
    expect((await contactByPk(toHex(id.publicKey)))?.name).toBe("Renombrada F73d");
  });

  it("control: re-presentación idéntica con el mismo nombre es éxito sin cambios", async () => {
    const id = generateIdentity();
    const sign = generateSigningKeypair();
    await m.pairWith(codeV2("Clave F73e", id, sign));
    const out = await m.pairWith(codeV2("Clave F73e", id, sign));
    expect(out).toEqual({ name: "Clave F73e" });
    const row = await contactByPk(toHex(id.publicKey));
    expect(row?.sigPkHex).toBe(toHex(sign.publicKey));
  });
});
