/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { convertUnits, validUnits, ConvertError } from "./convert.js";

describe("convertUnits", () => {
  it("convierte longitud", () => {
    expect(convertUnits(1, "km", "m").value).toBe(1000);
    expect(convertUnits(1, "mi", "km").value).toBeCloseTo(1.609344);
    expect(convertUnits(12, "in", "cm").value).toBeCloseTo(30.48);
  });

  it("acepta alias en español", () => {
    expect(convertUnits(2, "metros", "cm").value).toBe(200);
    expect(convertUnits(1, "libra", "kg").value).toBeCloseTo(0.45359237);
    expect(convertUnits(3, "pulgadas", "cm").value).toBeCloseTo(7.62);
    expect(convertUnits(1, "kilómetros", "m").value).toBe(1000);
  });

  it("convierte temperatura con desplazamiento", () => {
    expect(convertUnits(0, "c", "f").value).toBeCloseTo(32);
    expect(convertUnits(100, "c", "f").value).toBeCloseTo(212);
    expect(convertUnits(32, "f", "c").value).toBeCloseTo(0);
    expect(convertUnits(0, "c", "k").value).toBeCloseTo(273.15);
    expect(convertUnits(25, "celsius", "fahrenheit").value).toBeCloseTo(77);
  });

  it("convierte peso, volumen y tiempo", () => {
    expect(convertUnits(1, "kg", "g").value).toBe(1000);
    expect(convertUnits(1, "l", "ml").value).toBe(1000);
    expect(convertUnits(2, "h", "min").value).toBe(120);
    expect(convertUnits(1, "gal", "l").value).toBeCloseTo(3.785411784);
  });

  it("rechaza unidades desconocidas o incompatibles", () => {
    expect(() => convertUnits(1, "parsec", "m")).toThrow(ConvertError);
    expect(() => convertUnits(1, "m", "kg")).toThrow(ConvertError);
    expect(() => convertUnits(NaN, "m", "km")).toThrow(ConvertError);
  });

  it("expone la lista de unidades válidas", () => {
    const units = validUnits();
    expect(units).toContain("m");
    expect(units).toContain("kg");
    expect(units).toContain("c");
  });
});

describe("cero absoluto (0.1.75)", () => {
  it("por debajo no hay temperatura: -10 K y -500 °F se rechazan", () => {
    expect(() => convertUnits(-10, "kelvin", "celsius")).toThrow(ConvertError);
    expect(() => convertUnits(-500, "f", "c")).toThrow(ConvertError);
    expect(() => convertUnits(-300, "c", "k")).toThrow(ConvertError);
  });
  it("par: el propio cero absoluto y lo que está por encima sí", () => {
    expect(convertUnits(0, "kelvin", "celsius").value).toBeCloseTo(-273.15);
    expect(convertUnits(-459.67, "f", "k").value).toBeCloseTo(0);
    expect(convertUnits(-40, "c", "f").value).toBeCloseTo(-40);
  });
  it("el error lleva un código para traducirlo", () => {
    try { convertUnits(1, "parsec", "m"); } catch (e) { expect((e as ConvertError).code).toBe("unknownUnit"); }
    try { convertUnits(1, "m", "kg"); } catch (e) { expect((e as ConvertError).code).toBe("mismatch"); }
    try { convertUnits(-1, "k", "c"); } catch (e) { expect((e as ConvertError).code).toBe("belowAbsoluteZero"); }
  });
});

// ----------------------------------------------------------
// Paridad de piezas · F-PC46 (serie de curas, tanda de piezas)
// El censo entero de ALIASES como casos generados: las 123
// claves contadas sobre el bloque en la apertura de la tanda,
// cada una contra la unidad que la tabla le asigna (verdes al
// nacer). La lista es la foto de la apertura: la cura añade
// claves a la tabla, no a este censo. Especificación:
// FPC39-CURA-PREP §2.11 y §3.4.
describe("convertUnits — censo de ALIASES · paridad de piezas (F-PC46)", () => {
  const CENSO: Array<[string, string]> = [
    ["metro", "m"],
    ["metros", "m"],
    ["kilometro", "km"],
    ["kilometros", "km"],
    ["kilómetro", "km"],
    ["kilómetros", "km"],
    ["centimetro", "cm"],
    ["centimetros", "cm"],
    ["centímetro", "cm"],
    ["centímetros", "cm"],
    ["milimetro", "mm"],
    ["milimetros", "mm"],
    ["milímetro", "mm"],
    ["milímetros", "mm"],
    ["milla", "mi"],
    ["millas", "mi"],
    ["pie", "ft"],
    ["pies", "ft"],
    ["pulgada", "in"],
    ["pulgadas", "in"],
    ["kilogramo", "kg"],
    ["kilogramos", "kg"],
    ["kilo", "kg"],
    ["kilos", "kg"],
    ["gramo", "g"],
    ["gramos", "g"],
    ["libra", "lb"],
    ["libras", "lb"],
    ["onza", "oz"],
    ["onzas", "oz"],
    ["litro", "l"],
    ["litros", "l"],
    ["mililitro", "ml"],
    ["mililitros", "ml"],
    ["galon", "gal"],
    ["galones", "gal"],
    ["galón", "gal"],
    ["taza", "cup"],
    ["tazas", "cup"],
    ["segundo", "s"],
    ["segundos", "s"],
    ["minuto", "min"],
    ["minutos", "min"],
    ["hora", "h"],
    ["horas", "h"],
    ["dia", "day"],
    ["dias", "day"],
    ["día", "day"],
    ["días", "day"],
    ["celsius", "c"],
    ["centigrados", "c"],
    ["centígrados", "c"],
    ["grados", "c"],
    ["fahrenheit", "f"],
    ["kelvin", "k"],
    ["meter", "m"],
    ["meters", "m"],
    ["kilometer", "km"],
    ["kilometers", "km"],
    ["centimeter", "cm"],
    ["centimeters", "cm"],
    ["millimeter", "mm"],
    ["millimeters", "mm"],
    ["mile", "mi"],
    ["miles", "mi"],
    ["foot", "ft"],
    ["feet", "ft"],
    ["inch", "in"],
    ["inches", "in"],
    ["kilogram", "kg"],
    ["kilograms", "kg"],
    ["gram", "g"],
    ["grams", "g"],
    ["pound", "lb"],
    ["pounds", "lb"],
    ["ounce", "oz"],
    ["ounces", "oz"],
    ["liter", "l"],
    ["liters", "l"],
    ["litre", "l"],
    ["litres", "l"],
    ["milliliter", "ml"],
    ["milliliters", "ml"],
    ["gallon", "gal"],
    ["gallons", "gal"],
    ["second", "s"],
    ["seconds", "s"],
    ["minute", "min"],
    ["minutes", "min"],
    ["hour", "h"],
    ["hours", "h"],
    ["degree", "c"],
    ["degrees", "c"],
    ["quilometro", "km"],
    ["quilometros", "km"],
    ["quilômetro", "km"],
    ["quilômetros", "km"],
    ["milha", "mi"],
    ["milhas", "mi"],
    ["pé", "ft"],
    ["pés", "ft"],
    ["pe", "ft"],
    ["pes", "ft"],
    ["polegada", "in"],
    ["polegadas", "in"],
    ["quilo", "kg"],
    ["quilos", "kg"],
    ["quilograma", "kg"],
    ["quilogramas", "kg"],
    ["grama", "g"],
    ["gramas", "g"],
    ["onça", "oz"],
    ["onças", "oz"],
    ["galão", "gal"],
    ["galões", "gal"],
    ["galao", "gal"],
    ["galoes", "gal"],
    ["xícara", "cup"],
    ["xícaras", "cup"],
    ["xicara", "cup"],
    ["xicaras", "cup"],
    ["graus", "c"],
    ["grau", "c"],
  ];
  it.each(CENSO)("alias %s → %s", (alias, unit) => {
    expect(convertUnits(1, alias, unit).value).toBeCloseTo(1);
  });

  // Las formas ausentes de la tabla: los plurales de la caza
  // y la familia británica en -re (la única admitida hoy es
  // litre|litres). Rojos de nacimiento especificados: 8.
  it.each([
    ["cups", "cup"],
    ["days", "day"],
    ["metre", "m"],
    ["metres", "m"],
    ["centimetres", "cm"],
    ["kilometres", "km"],
    ["millimetres", "mm"],
    ["millilitres", "ml"],
  ])("forma ausente %s → %s", (alias, unit) => {
    expect(convertUnits(1, alias as string, unit as string).value).toBeCloseTo(1);
  });
});
