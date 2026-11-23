/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de las curas H-03 y H-04 (cadena de curas, acto 9):
 * las descripciones del catálogo dicen la fuente verdadera
 * de PC. find_contact buscaba «contactos del teléfono
 * (permiso del usuario)» cuando el ejecutor busca en la
 * agenda de NIDO de esta computadora, y las dos de
 * calendario decían «del teléfono» cuando el calendario es
 * el de NIDO sobre su base cifrada desde E7. Los ejecutores
 * ya decían la verdad; mentía solo la letra del manifiesto,
 * que es la que el modelo lee y la tarjeta de permisos
 * pinta.
 *
 * Los tres primeros casos cobran las letras exactas de la
 * cura; el cuarto deja la clase cerrada: ninguna
 * descripción del catálogo (de herramienta ni de
 * parámetro) promete el teléfono ni su permiso. Nace en
 * rojo contra las letras viejas.
 */

import { describe, expect, it } from "vitest";
import { LOCAL_TOOLS } from "./manifest.js";

const FIND_CONTACT =
  "Busca por nombre en la agenda de NIDO de esta computadora, guardada en su base cifrada. No vuelca la agenda completa.";
const CREATE_EVENT =
  "Crea un evento en el calendario de NIDO de esta computadora, guardado en su base cifrada. No toca el calendario del sistema.";
const LIST_EVENTS =
  "Lista eventos del calendario de NIDO de esta computadora en un rango de fechas.";

describe("curas H-03/H-04 · las descripciones dicen la fuente verdadera de PC", () => {
  it("find_contact busca en la agenda de NIDO de esta computadora", () => {
    expect(LOCAL_TOOLS.find((t) => t.name === "find_contact")?.description).toBe(FIND_CONTACT);
  });

  it("create_calendar_event crea en el calendario de NIDO, no en el del teléfono", () => {
    expect(LOCAL_TOOLS.find((t) => t.name === "create_calendar_event")?.description).toBe(CREATE_EVENT);
  });

  it("list_calendar_events lista el calendario de NIDO de esta computadora", () => {
    expect(LOCAL_TOOLS.find((t) => t.name === "list_calendar_events")?.description).toBe(LIST_EVENTS);
  });

  it("ninguna descripción del catálogo promete el teléfono ni su permiso", () => {
    const texts: string[] = [];
    for (const t of LOCAL_TOOLS) {
      texts.push(t.description);
      for (const p of Object.values(t.parameters ?? {})) texts.push(p.description);
    }
    for (const text of texts) {
      expect(text).not.toContain("del teléfono");
      expect(text).not.toContain("(permiso del usuario)");
    }
  });
});
