/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Offensive audit (0.1.18): a reminder must ring when the user said, or not
 * be scheduled at all — never at a different time.
 */
import { afterEach, describe, expect, it } from "vitest";
import { nextOccurrence } from "../memory/reminderRepeat.js";
import { extractReminderAction, parseReminderDateTime } from "./actionRouter.js";

// Monday 12 Oct 2026, 06:57 local time.
const NOW = new Date(2026, 9, 12, 6, 57);
const at = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe("reminders — part of the day", () => {
  it.each([
    ["correr a las 7 de la mañana", "2026-10-12 07:00"],
    ["correr mañana a las 7 de la mañana", "2026-10-13 07:00"],
    ["cenar a las 9 de la noche", "2026-10-12 21:00"],
    ["algo a las 3 de la tarde", "2026-10-12 15:00"],
    ["algo a las 2 de la madrugada", "2026-10-13 02:00"],
    ["algo a las 12 de la noche", "2026-10-13 00:00"],
    ["algo esta noche a las 9", "2026-10-12 21:00"],
    ["algo mañana por la tarde", "2026-10-13 16:00"],
    ["algo a mediodía", "2026-10-12 12:00"],
    ["algo a las 0", "2026-10-13 00:00"],
    ["x at 7 in the morning", "2026-10-12 07:00"],
    ["x at 9 tonight", "2026-10-12 21:00"],
    ["algo às 7 da manhã", "2026-10-12 07:00"],
    ["algo às 8 da noite", "2026-10-12 20:00"],
    ["algo en media hora", "2026-10-12 07:27"],
  ])("%s → %s", (text, expected) => {
    expect(at(parseReminderDateTime(text, NOW))).toBe(expected);
  });

  it("the part of the day doesn't stay in the reminder text", () => {
    expect(extractReminderAction("recuérdame correr a las 7 de la mañana")?.text).toBe("correr");
    expect(extractReminderAction("recuérdame cenar a las 9 de la noche")?.text).toBe("cenar");
  });
});

describe("reminders — dates that don't exist or already passed", () => {
  it("29 February goes to the next real one", () => {
    expect(at(parseReminderDateTime("algo el 29 de febrero", NOW))).toBe("2028-02-29 09:00");
  });
  it("an explicit year is respected; a past one gives no date", () => {
    expect(at(parseReminderDateTime("algo el 1 de enero de 2027", NOW))).toBe("2027-01-01 09:00");
    expect(at(parseReminderDateTime("x on march 3rd, 2027", NOW))).toBe("2027-03-03 09:00");
    expect(parseReminderDateTime("algo el 1 de enero de 1990", NOW)).toBeNull();
    expect(parseReminderDateTime("algo el 29 de febrero de 2027", NOW)).toBeNull();
  });
  it("today's date without a time stays today if it's still ahead", () => {
    expect(at(parseReminderDateTime("algo el 12 de octubre", NOW))).toBe("2026-10-12 09:00");
  });
  it("auditoría 2026-10-31 (F1 M-1): una fecha nombrada ya pasada hoy va a su próximo año, no a mañana", () => {
    const march15at10 = new Date(2026, 2, 15, 10, 0);
    expect(at(parseReminderDateTime("algo el 15 de marzo a las 9", march15at10))).toBe("2027-03-15 09:00");
    expect(at(parseReminderDateTime("algo el 15 de marzo", march15at10))).toBe("2027-03-15 09:00");
    // El control: el 16 sí es mañana de verdad.
    expect(at(parseReminderDateTime("algo el 16 de marzo a las 9", march15at10))).toBe("2026-03-16 09:00");
    // Y una hora suelta sin fecha sigue rodando a mañana, como siempre.
    expect(at(parseReminderDateTime("algo a las 9", march15at10))).toBe("2026-03-16 09:00");
  });
  it.each(["algo el 31 de febrero", "algo a las 25", "algo a las 12:75", "algo en 0 minutos", "algo en -5 minutos"])(
    "%s → no date",
    (text) => {
      expect(parseReminderDateTime(text, NOW)).toBeNull();
    },
  );
});

describe("remembered dates (birthdays)", () => {
  it("29 February is never turned into 1 March", async () => {
    const { extractDateISO } = await import("./rememberRouter.js");
    const iso = extractDateISO("el cumpleaños de Ana es el 29 de febrero");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect([d.getMonth(), d.getDate()]).toEqual([1, 29]);
  });
});

/**
 * E8 (paso 1): los bordes de reloj de la repetición, contra la
 * pieza pura del móvil (`nextOccurrence` de reminderRepeat):
 * T-2 el cambio de hora estacional, T-3 el cambio de huso y
 * T-4 las ocurrencias saltadas que la recuperación cuenta en
 * `missed_count`. El huso se fija por caso y se restaura, como
 * hace calendarReal.test.ts en esta misma casa.
 */
describe("reminderRepeat — bordes de reloj (E8)", () => {
  const TZ_ORIG = process.env.TZ;
  afterEach(() => {
    if (TZ_ORIG === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIG;
  });
  const local = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  it("T-2 · la serie diaria conserva su hora local al entrar el horario de verano", () => {
    process.env.TZ = "America/New_York";
    const base = new Date(2026, 2, 6, 9, 0); // viernes 6 de marzo, EST
    const sabado = nextOccurrence(base, "day", new Date(2026, 2, 6, 12, 0));
    expect(local(sabado)).toBe("2026-03-07 09:00");
    const domingo = nextOccurrence(base, "day", sabado); // 8 de marzo: salta 02:00→03:00
    expect(local(domingo)).toBe("2026-03-08 09:00");
    const lunes = nextOccurrence(base, "day", domingo);
    expect(local(lunes)).toBe("2026-03-09 09:00");
  });

  it("T-2 · una hora dentro del salto cae en la hora real de ese día y la serie recupera la suya", () => {
    process.env.TZ = "America/New_York";
    const base = new Date(2026, 2, 6, 2, 30);
    const domingo = nextOccurrence(base, "day", new Date(2026, 2, 7, 12, 0));
    // El 8 de marzo de 2026 las 02:30 no existen en Nueva York:
    // el instante real de ese paso es 03:30 EDT.
    expect(local(domingo)).toBe("2026-03-08 03:30");
    const lunes = nextOccurrence(base, "day", domingo);
    expect(local(lunes)).toBe("2026-03-09 02:30");
  });

  it("T-2 · al salir el horario de verano el día largo no corre la hora", () => {
    process.env.TZ = "America/New_York";
    const base = new Date(2026, 9, 30, 9, 0); // viernes 30 de octubre, EDT
    const sabado = nextOccurrence(base, "day", new Date(2026, 9, 30, 12, 0));
    expect(local(sabado)).toBe("2026-10-31 09:00");
    const domingo = nextOccurrence(base, "day", sabado); // 1 de noviembre: el día de 25 horas
    expect(local(domingo)).toBe("2026-11-01 09:00");
    expect(domingo.getTime() - sabado.getTime()).toBe(25 * 3600 * 1000);
  });

  it("T-3 · con cambio de huso la serie sigue la hora de pared, no el instante absoluto", () => {
    process.env.TZ = "America/New_York";
    const baseNY = new Date(2026, 2, 6, 9, 0);
    expect(baseNY.getTime()).toBe(Date.UTC(2026, 2, 6, 14, 0));
    // La verdad guardada es la hora local (base_local); al movernos
    // de huso se reconstruye con los mismos campos en el huso nuevo.
    process.env.TZ = "America/Los_Angeles";
    const baseLA = new Date(2026, 2, 6, 9, 0);
    const next = nextOccurrence(baseLA, "day", new Date(2026, 2, 6, 12, 0));
    expect(local(next)).toBe("2026-03-07 09:00");
  });

  it("T-3 · la serie semanal conserva su día y su hora de pared tras el cambio de huso", () => {
    process.env.TZ = "America/Phoenix";
    const basePhx = new Date(2026, 9, 12, 18, 30); // lunes 12 de octubre
    expect(basePhx.getDay()).toBe(1);
    process.env.TZ = "America/New_York";
    const baseNY = new Date(2026, 9, 12, 18, 30);
    const next = nextOccurrence(baseNY, "week", new Date(2026, 9, 13, 9, 0));
    expect(local(next)).toBe("2026-10-19 18:30");
    expect(next.getDay()).toBe(1);
  });

  // El conteo de ocurrencias debidas entre el último disparo y
  // ahora: la última se presenta y el resto es lo que la
  // recuperación suma a `missed_count`.
  const countDue = (
    base: Date,
    repeat: "day" | "week" | "month" | "year",
    fromExclusive: Date,
    uptoInclusive: Date,
  ): number => {
    let n = 0;
    let cursor = fromExclusive;
    for (let i = 0; i < 1000; i++) {
      const next = nextOccurrence(base, repeat, cursor);
      if (next.getTime() > uptoInclusive.getTime()) return n;
      n++;
      cursor = next;
    }
    return n;
  };

  it("T-4 · serie diaria: cuatro debidas en cinco días, tres saltadas tras la presentada", () => {
    process.env.TZ = "America/Phoenix";
    const base = new Date(2026, 9, 12, 9, 0); // lunes
    const due = countDue(base, "day", base, new Date(2026, 9, 16, 10, 0)); // viernes 10:00
    expect(due).toBe(4);
    expect(due - 1).toBe(3);
  });

  it("T-4 · serie semanal: la de hoy a las 09:00 aún no es debida a las 08:00", () => {
    process.env.TZ = "America/Phoenix";
    const base = new Date(2026, 8, 7, 9, 0); // lunes 7 de septiembre
    const due = countDue(base, "week", base, new Date(2026, 9, 5, 8, 0)); // lunes 5 de octubre, 08:00
    expect(due).toBe(3); // 14, 21 y 28 de septiembre
    expect(due - 1).toBe(2);
  });

  it("T-4 · serie mensual en día 31: los meses sin 31 no producen ocurrencia", () => {
    process.env.TZ = "America/Phoenix";
    const base = new Date(2026, 0, 31, 9, 0);
    const due = countDue(base, "month", base, new Date(2026, 5, 1, 0, 0));
    expect(due).toBe(2); // 31 de marzo y 31 de mayo; febrero y abril no tienen 31
  });

  it("T-4 · serie anual del 29 de febrero: sin ocurrencias en los años no bisiestos", () => {
    process.env.TZ = "America/Phoenix";
    const base = new Date(2024, 1, 29, 9, 0);
    const due = countDue(base, "year", base, new Date(2029, 0, 1, 0, 0));
    expect(due).toBe(1); // solo el 29 de febrero de 2028
    expect(due - 1).toBe(0);
  });
});
