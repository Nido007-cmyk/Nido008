/**
 * handlersLangParidad.test.ts — batería de paridad de salidas de
 * handlers.ts (F-PC50, serie de curas). Los 24 handlers del censo
 * ejercitados por buildToolHandlers con el idioma fijado por
 * setHandlerLangForTest, en su acción principal y en su error
 * determinista principal donde lo tenga: en español afirma la
 * cadena de hoy (control); en inglés y portugués, la cadena que
 * la cura de F-PC50 escribe por L(), en su texto exacto para las
 * confirmaciones y por su prefijo de la casa para los errores
 * con mensaje interno.
 *
 * Ejecución declarada en esta casa: no hay módulos nativos de
 * contactos ni selector de archivos, ni react-native;
 * esos handlers sirven su texto de no disponible o de fallo al
 * abrir, y ese es el texto que su caso afirma. El calendario ya
 * no es de esa clase: desde E7 paso 2 es el calendario real de
 * NIDO sobre la base cifrada, y su sección corre contra una
 * base temporal con su DEK de prueba. El banco es el
 * registro en memoria de DET-11 (memoryStore y el mensajero
 * compartido); cada caso dispone su propio estado con nombres
 * únicos y cobra los ids y las fechas del propio banco, así que
 * ningún caso depende del orden salvo list_notes, que abre la
 * batería con el almacén de notas vacío por construcción.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import { buildToolHandlers, setHandlerLangForTest, fmtDateTime } from "./handlers.js";
import {
  listNotes,
  listReminders,
  getFacts,
  saveNote as storeSaveNote,
  saveReminder as storeSaveReminder,
  saveFact as storeSaveFact,
} from "../memory/memoryStore.js";
import { listSkills, loadSkill } from "../skills/registry.js";
import { getSharedNidoMessenger } from "../../services/nidoMessenger.js";
import { generateIdentity } from "../../p2p/crypto.js";
import { encodePairingPayload } from "../../p2p/pairing.js";
import type { RouterLang } from "../loop/toolRouter.js";

const LANGS: RouterLang[] = ["es", "en", "pt"];
type Tri = Record<RouterLang, string>;

const H = () => buildToolHandlers({ requestConfirm: async () => true });

afterEach(() => {
  setHandlerLangForTest(null);
});

// ---------------------------------------------------------------- notas

describe("paridad de salidas · notas", () => {
  const EMPTY: Tri = {
    es: "No hay notas guardadas todavía.",
    en: "There are no saved notes yet.",
    pt: "Ainda não há notas guardadas.",
  };
  const HEADER: Tri = { es: "Notas guardadas:", en: "Saved notes:", pt: "Notas guardadas:" };
  const FOOTER: Tri = {
    es: "Usa read_note con el id para leer una completa.",
    en: "Use read_note with the id to read one in full.",
    pt: "Usa read_note com o id para ler uma completa.",
  };

  for (const lang of LANGS) {
    it(`list_notes · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      if (lang === "es") {
        // Este caso abre la batería: el almacén de notas está vacío.
        expect(await h["list_notes"]({})).toBe(EMPTY[lang]);
        await storeSaveNote({ title: "Lista de la compra", body: "leche y pan" });
      }
      const [note] = await listNotes(20);
      const expected =
        `${HEADER[lang]}\n` +
        `- «${note.title}» (id ${note.id}, ${fmtDateTime(note.created_at)})\n` +
        FOOTER[lang];
      expect(await h["list_notes"]({})).toBe(expected);
    });
  }

  const SAVE_OK: Record<RouterLang, (t: string, id: string) => string> = {
    es: (t, id) => `Nota guardada: «${t}» (id ${id}).`,
    en: (t, id) => `Note saved: “${t}” (id ${id}).`,
    pt: (t, id) => `Nota guardada: «${t}» (id ${id}).`,
  };
  const SAVE_ERR: Tri = {
    es: "Error: falta el título de la nota.",
    en: "Error: the note title is missing.",
    pt: "Erro: falta o título da nota.",
  };

  for (const lang of LANGS) {
    it(`save_note · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const title = `Apunte de paridad ${lang}`;
      const out = await h["save_note"]({ title, body: "cuerpo" });
      const mine = (await listNotes(20)).find((n) => n.title === title);
      expect(mine).toBeTruthy();
      expect(out).toBe(SAVE_OK[lang](title, mine!.id));
      expect(await h["save_note"]({ body: "sin título" })).toBe(SAVE_ERR[lang]);
    });
  }

  const READ_NOT_FOUND: Record<RouterLang, (id: string) => string> = {
    es: (id) => `No encontré ninguna nota con id ${id}.`,
    en: (id) => `I couldn't find any note with id ${id}.`,
    pt: (id) => `Não encontrei nenhuma nota com id ${id}.`,
  };
  const READ_NO_ID: Tri = {
    es: "Error: falta el id de la nota.",
    en: "Error: the note id is missing.",
    pt: "Erro: falta o id da nota.",
  };

  for (const lang of LANGS) {
    it(`read_note · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const note = await storeSaveNote({ title: `Diario de paridad ${lang}`, body: "hoy llovió" });
      const expected = `«${note.title}» (${fmtDateTime(note.created_at)}):\nhoy llovió`;
      expect(await h["read_note"]({ id: note.id })).toBe(expected);
      expect(await h["read_note"]({ id: "n-999999" })).toBe(READ_NOT_FOUND[lang]("n-999999"));
      expect(await h["read_note"]({})).toBe(READ_NO_ID[lang]);
    });
  }

  const DELETE_OK: Record<RouterLang, (t: string) => string> = {
    es: (t) => `Nota borrada: «${t}».`,
    en: (t) => `Note deleted: “${t}”.`,
    pt: (t) => `Nota apagada: «${t}».`,
  };
  const DELETE_THROW: Tri = {
    es: "la nota confirmada no coincide con la guardada; no se borró nada",
    en: "the confirmed note doesn't match the saved one; nothing was deleted",
    pt: "a nota confirmada não coincide com a guardada; nada foi apagado",
  };

  for (const lang of LANGS) {
    it(`delete_note · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const note = await storeSaveNote({ title: `Borrable ${lang}`, body: "" });
      expect(await h["delete_note"]({ id: note.id, title: note.title })).toBe(
        DELETE_OK[lang](note.title),
      );
      const other = await storeSaveNote({ title: `Intocable ${lang}`, body: "" });
      await expect(
        h["delete_note"]({ id: other.id, title: "otra etiqueta" }),
      ).rejects.toThrow(DELETE_THROW[lang]);
      expect(await h["delete_note"]({ id: "n-999999" })).toBe(
        READ_NOT_FOUND[lang]("n-999999"),
      );
    });
  }
});

// ------------------------------------------------------- memoria y personas

describe("paridad de salidas · memoria y personas", () => {
  // E7 paso 4: save_person escribe la ficha en la base cifrada;
  // los casos de personas corren contra una temporal real.
  let memDir: string;
  const MEM_KEY = randomBytes(32);
  beforeEach(async () => {
    await closeDatabase();
    memDir = mkdtempSync(join(tmpdir(), "nido-paridad-mem-"));
    setAppStoreDir(memDir);
    setAppStoreDekProvider(() => Buffer.from(MEM_KEY));
  });
  afterEach(async () => {
    await closeDatabase();
    setAppStoreDekProvider(null);
    setAppStoreDir(null);
    rmSync(memDir, { recursive: true, force: true });
  });

  const MEM_OK: Record<RouterLang, (c: string) => string> = {
    es: (c) => `Recuerdo borrado: «${c}».`,
    en: (c) => `Memory deleted: “${c}”.`,
    pt: (c) => `Lembrança apagada: «${c}».`,
  };
  const MEM_NOT_FOUND: Record<RouterLang, (id: string) => string> = {
    es: (id) => `No encontré ese recuerdo (id ${id}).`,
    en: (id) => `I couldn't find that memory (id ${id}).`,
    pt: (id) => `Não encontrei essa lembrança (id ${id}).`,
  };
  const MEM_NO_ID: Tri = {
    es: "Error: falta el id del recuerdo.",
    en: "Error: the memory id is missing.",
    pt: "Erro: falta o id da lembrança.",
  };
  const MEM_THROW: Tri = {
    es: "el recuerdo confirmado no coincide con el guardado; no se borró nada",
    en: "the confirmed memory doesn't match the saved one; nothing was deleted",
    pt: "a lembrança confirmada não coincide com a guardada; nada foi apagado",
  };

  for (const lang of LANGS) {
    it(`delete_memory · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const content = `dato de paridad ${lang}`;
      await storeSaveFact({ content, category: "general", source: "user" });
      const fact = (await getFacts(500)).find((f) => f.content === content);
      expect(fact).toBeTruthy();
      expect(
        await h["delete_memory"]({ id: fact!.id, kind: "fact", content }),
      ).toBe(MEM_OK[lang](content));
      const content2 = `dato intocable ${lang}`;
      await storeSaveFact({ content: content2, category: "general", source: "user" });
      const fact2 = (await getFacts(500)).find((f) => f.content === content2);
      await expect(
        h["delete_memory"]({ id: fact2!.id, kind: "fact", content: "otra cosa" }),
      ).rejects.toThrow(MEM_THROW[lang]);
      expect(await h["delete_memory"]({ id: "f-999999", kind: "fact" })).toBe(
        MEM_NOT_FOUND[lang]("f-999999"),
      );
      expect(await h["delete_memory"]({})).toBe(MEM_NO_ID[lang]);
    });
  }

  const REM_DEL_OK: Record<RouterLang, (t: string) => string> = {
    es: (t) => `Recordatorio borrado: «${t}».`,
    en: (t) => `Reminder deleted: “${t}”.`,
    pt: (t) => `Lembrete apagado: «${t}».`,
  };
  const REM_NOT_FOUND: Record<RouterLang, (id: string) => string> = {
    es: (id) => `No encontré ningún recordatorio con id ${id}.`,
    en: (id) => `I couldn't find any reminder with id ${id}.`,
    pt: (id) => `Não encontrei nenhum lembrete com id ${id}.`,
  };
  const REM_NO_ID: Tri = {
    es: "Error: falta el id del recordatorio.",
    en: "Error: the reminder id is missing.",
    pt: "Erro: falta o id do lembrete.",
  };
  const REM_THROW: Tri = {
    es: "el recordatorio confirmado no coincide con el guardado; no se borró nada",
    en: "the confirmed reminder doesn't match the saved one; nothing was deleted",
    pt: "o lembrete confirmado não coincide com o guardado; nada foi apagado",
  };

  for (const lang of LANGS) {
    it(`delete_reminder · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const text = `regar de paridad ${lang}`;
      await storeSaveReminder({ text, dueAt: null });
      const rem = (await listReminders(200)).find((r) => r.text === text);
      expect(rem).toBeTruthy();
      expect(await h["delete_reminder"]({ id: rem!.id, text })).toBe(REM_DEL_OK[lang](text));
      const text2 = `regar intocable ${lang}`;
      await storeSaveReminder({ text: text2, dueAt: null });
      const rem2 = (await listReminders(200)).find((r) => r.text === text2);
      await expect(
        h["delete_reminder"]({ id: rem2!.id, text: "otro texto" }),
      ).rejects.toThrow(REM_THROW[lang]);
      expect(await h["delete_reminder"]({ id: "r-999999" })).toBe(
        REM_NOT_FOUND[lang]("r-999999"),
      );
      expect(await h["delete_reminder"]({})).toBe(REM_NO_ID[lang]);
    });
  }

  const REM_OK_NODATE: Record<RouterLang, (t: string) => string> = {
    es: (t) => `Recordatorio guardado (sin fecha): «${t}». Te avisaré al abrir NIDO cuando llegue la hora.`,
    en: (t) => `Reminder saved (no date): “${t}”. I'll remind you when you open NIDO once it's time.`,
    pt: (t) => `Lembrete guardado (sem data): «${t}». Aviso você ao abrir o NIDO quando chegar a hora.`,
  };
  const REM_OK_DATE: Record<RouterLang, (t: string, f: string) => string> = {
    es: (t, f) => `Recordatorio guardado para ${f}: «${t}». Te avisaré al abrir NIDO cuando llegue la hora.`,
    en: (t, f) => `Reminder saved for ${f}: “${t}”. I'll remind you when you open NIDO once it's time.`,
    pt: (t, f) => `Lembrete guardado para ${f}: «${t}». Aviso você ao abrir o NIDO quando chegar a hora.`,
  };
  const REM_NO_TEXT: Tri = {
    es: "Error: falta el texto del recordatorio.",
    en: "Error: the reminder text is missing.",
    pt: "Erro: falta o texto do lembrete.",
  };

  for (const lang of LANGS) {
    it(`create_reminder · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const text = `comprar pan de paridad ${lang}`;
      expect(await h["create_reminder"]({ text })).toBe(REM_OK_NODATE[lang](text));
      const at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const text2 = `dentista de paridad ${lang}`;
      const expected = REM_OK_DATE[lang](text2, fmtDateTime(new Date(at).toISOString()));
      expect(await h["create_reminder"]({ text: text2, at })).toBe(expected);
      expect(await h["create_reminder"]({})).toBe(REM_NO_TEXT[lang]);
    });
  }

  const FACT_OK: Record<RouterLang, (c: string) => string> = {
    es: (c) => `Guardado en mi memoria: «${c}» (categoría: general).`,
    en: (c) => `Saved in my memory: “${c}” (category: general).`,
    pt: (c) => `Guardado na minha memória: «${c}» (categoria: general).`,
  };
  const FACT_SUFFIX: Tri = {
    es: ` Veo que menciona una fecha — si quieres que te avise con tiempo, pídeme "créame un recordatorio para..."`,
    en: ` I see it mentions a date — if you want me to warn you ahead of time, ask me "create a reminder for..."`,
    pt: ` Vejo que menciona uma data — se você quiser que eu avise com antecedência, peça "crie um lembrete para..."`,
  };
  const FACT_NO_CONTENT: Tri = {
    es: "Error: falta el contenido del hecho.",
    en: "Error: the fact content is missing.",
    pt: "Erro: falta o conteúdo do fato.",
  };

  for (const lang of LANGS) {
    it(`remember_fact · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const content = `el té de paridad ${lang} se toma sin azúcar`;
      expect(await h["remember_fact"]({ content })).toBe(FACT_OK[lang](content));
      const dated = `la revisión de paridad ${lang} es el 5 de mayo`;
      expect(await h["remember_fact"]({ content: dated })).toBe(
        FACT_OK[lang](dated) + FACT_SUFFIX[lang],
      );
      expect(await h["remember_fact"]({})).toBe(FACT_NO_CONTENT[lang]);
    });
  }

  const PERSON_OK: Record<RouterLang, (n: string, r: string) => string> = {
    es: (n, r) => `Persona guardada: «${n}» (${r}).`,
    en: (n, r) => `Person saved: “${n}” (${r}).`,
    pt: (n, r) => `Pessoa guardada: «${n}» (${r}).`,
  };
  const PERSON_NO_NAME: Tri = {
    es: "Error: falta el nombre de la persona.",
    en: "Error: the person's name is missing.",
    pt: "Erro: falta o nome da pessoa.",
  };

  for (const lang of LANGS) {
    it(`save_person · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const name = `Persona de paridad ${lang}`;
      expect(await h["save_person"]({ name, relationship: "hermana" })).toBe(
        PERSON_OK[lang](name, "hermana"),
      );
      expect(await h["save_person"]({})).toBe(PERSON_NO_NAME[lang]);
    });
  }
});

// ------------------------------------------------------------- Fase B y D

describe("paridad de salidas · abrir, calcular, convertir", () => {
  const OPEN_FAIL: Record<RouterLang, (u: string) => string> = {
    es: (u) => `No pude abrir ${u} desde NIDO.`,
    en: (u) => `I couldn't open ${u} from NIDO.`,
    pt: (u) => `Não consegui abrir ${u} do NIDO.`,
  };

  for (const lang of LANGS) {
    it(`open_app · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      // Sin react-native en esta casa, el handler sirve su texto de
      // fallo al abrir: es la acción que el banco puede ejercitar.
      expect(await h["open_app"]({ link: "https://example.com" })).toBe(
        OPEN_FAIL[lang]("https://example.com"),
      );
    });
  }

  const CALC_NO_EXPR: Tri = {
    es: "Error: falta la expresión a calcular.",
    en: "Error: the expression to calculate is missing.",
    pt: "Erro: falta a expressão a calcular.",
  };
  const CALC_PREFIX: Tri = {
    es: "No pude calcular eso: ",
    en: "I couldn't calculate that: ",
    pt: "Não consegui calcular isso: ",
  };

  for (const lang of LANGS) {
    it(`calculate · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      expect(await h["calculate"]({ expression: "2 + 3 * 4" })).toBe("2 + 3 * 4 = 14");
      expect(await h["calculate"]({})).toBe(CALC_NO_EXPR[lang]);
      const bad = await h["calculate"]({ expression: "2 +" });
      expect(bad.startsWith(CALC_PREFIX[lang])).toBe(true);
    });
  }

  const CONV_NO_VALUE: Tri = {
    es: "Error: el valor a convertir debe ser un número.",
    en: "Error: the value to convert must be a number.",
    pt: "Erro: o valor a converter deve ser um número.",
  };
  const CONV_NO_UNITS: Tri = {
    es: "Error: indica la unidad de origen y la de destino.",
    en: "Error: give the source unit and the target unit.",
    pt: "Erro: indica a unidade de origem e a de destino.",
  };

  for (const lang of LANGS) {
    it(`convert_units · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      expect(await h["convert_units"]({ value: 1, from: "km", to: "m" })).toBe(
        "1 km = 1000 m",
      );
      expect(await h["convert_units"]({ value: "x", from: "km", to: "m" })).toBe(
        CONV_NO_VALUE[lang],
      );
      expect(await h["convert_units"]({ value: 1 })).toBe(CONV_NO_UNITS[lang]);
    });
  }
});

// ------------------------------------------- calendario, contactos, teléfono

describe("paridad de salidas · calendario, contactos, teléfono, archivo", () => {
  // E7 pasos 2 y 4: el calendario y la agenda son reales. Los
  // casos corren contra una base cifrada temporal y afirman la
  // salida real por L() en los tres idiomas.
  let calDir: string;
  const CAL_KEY = randomBytes(32);
  beforeEach(async () => {
    await closeDatabase();
    calDir = mkdtempSync(join(tmpdir(), "nido-paridad-cal-"));
    setAppStoreDir(calDir);
    setAppStoreDekProvider(() => Buffer.from(CAL_KEY));
  });
  afterEach(async () => {
    await closeDatabase();
    setAppStoreDekProvider(null);
    setAppStoreDir(null);
    rmSync(calDir, { recursive: true, force: true });
  });

  describe("calendario real (E7 paso 2)", () => {
    const CAL_CREATED: Tri = {
      es: "Evento creado: «X», ",
      en: "Event created: “X”, ",
      pt: "Evento criado: «X», ",
    };
    for (const lang of LANGS) {
      it(`create_calendar_event · ${lang}`, async () => {
        setHandlerLangForTest(lang);
        const h = H();
        const iso = new Date("2026-09-28T10:00:00").toISOString();
        expect(
          await h["create_calendar_event"]({ title: "X", start: "2026-09-28T10:00:00" }),
        ).toBe(`${CAL_CREATED[lang]}${fmtDateTime(iso)}.`);
      });
    }

    const CAL_EMPTY: Tri = {
      es: "No hay eventos en ese rango.",
      en: "There are no events in that range.",
      pt: "Não há eventos nesse intervalo.",
    };
    for (const lang of LANGS) {
      it(`list_calendar_events · ${lang}`, async () => {
        setHandlerLangForTest(lang);
        const h = H();
        expect(await h["list_calendar_events"]({})).toBe(CAL_EMPTY[lang]);
      });
    }
  });

  // E7 paso 4: find_contact lee la agenda real de NIDO (la base
  // cifrada temporal de esta batería, vacía): sin coincidencias,
  // la respuesta nombra la agenda de NIDO en el idioma fijado.
  const CONTACTS_NOT_FOUND: Tri = {
    es: "No encontré ningún contacto que coincida con «Ana» en tu agenda de NIDO.",
    en: "I couldn't find any contact matching “Ana” in your NIDO address book.",
    pt: "Não encontrei nenhum contato que corresponda a «Ana» na sua agenda do NIDO.",
  };
  const CONTACTS_NO_NAME: Tri = {
    es: "Error: falta el nombre a buscar.",
    en: "Error: the name to search for is missing.",
    pt: "Erro: falta o nome a buscar.",
  };

  for (const lang of LANGS) {
    it(`find_contact · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      expect(await h["find_contact"]({ query: "Ana" })).toBe(CONTACTS_NOT_FOUND[lang]);
      expect(await h["find_contact"]({})).toBe(CONTACTS_NO_NAME[lang]);
    });
  }

  const FILE_PREFIX: Tri = {
    es: "No pude leer el archivo: ",
    en: "I couldn't read the file: ",
    pt: "Não consegui ler o arquivo: ",
  };

  for (const lang of LANGS) {
    it(`read_picked_file · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      // Sin el módulo de selección, el handler sirve su prefijo de
      // error con el mensaje interno de la importación.
      const out = await h["read_picked_file"]({});
      expect(out.startsWith(FILE_PREFIX[lang])).toBe(true);
      expect(out.length).toBeGreaterThan(FILE_PREFIX[lang].length);
    });
  }
});

// ------------------------------------------------------------- skills y tabla

describe("paridad de salidas · skills y tabla", () => {
  const SKILL_ASK: Record<RouterLang, (a: string) => string> = {
    es: (a) => `Indica el nombre de la skill. Disponibles: ${a}.`,
    en: (a) => `Give the skill name. Available: ${a}.`,
    pt: (a) => `Indica o nome da skill. Disponíveis: ${a}.`,
  };
  const SKILL_UNKNOWN: Record<RouterLang, (n: string, a: string) => string> = {
    es: (n, a) => `No conozco la skill «${n}». Disponibles: ${a}.`,
    en: (n, a) => `I don't know the skill “${n}”. Available: ${a}.`,
    pt: (n, a) => `Não conheço a skill «${n}». Disponíveis: ${a}.`,
  };
  const SKILL_OK: Record<RouterLang, (n: string, i: string) => string> = {
    es: (n, i) => `Skill «${n}» cargada. Este es su procedimiento:\n\n${i}`,
    en: (n, i) => `Skill “${n}” loaded. Here is its procedure:\n\n${i}`,
    pt: (n, i) => `Skill «${n}» carregada. Este é o seu procedimento:\n\n${i}`,
  };

  for (const lang of LANGS) {
    it(`use_skill · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const available = listSkills().map((s) => s.name).join(", ");
      const first = listSkills()[0];
      expect(first).toBeTruthy();
      const skill = loadSkill(first.name);
      expect(skill).toBeTruthy();
      expect(await h["use_skill"]({ name: first.name })).toBe(
        SKILL_OK[lang](first.name, skill!.instructions),
      );
      expect(await h["use_skill"]({})).toBe(SKILL_ASK[lang](available));
      expect(await h["use_skill"]({ name: "skill-que-no-existe" })).toBe(
        SKILL_UNKNOWN[lang]("skill-que-no-existe", available),
      );
    });
  }

  const TABLE_OUT =
    "Tabla: 2 filas × 2 columnas\n" +
    "Columnas: nombre | edad\n" +
    "— nombre (texto): 2 valores únicos; top: «Ana»(1), «Luis»(1)\n" +
    "— edad (número): n=2, suma=55, prom=27.5, min=25, max=30\n" +
    "Primeras 2 filas:\n" +
    "  Ana | 30\n" +
    "  Luis | 25";
  const TABLE_NO_TEXT: Tri = {
    es: "Error: falta el texto de la tabla a analizar.",
    en: "Error: the table text to analyze is missing.",
    pt: "Erro: falta o texto da tabela a analisar.",
  };
  const TABLE_TOO_BIG: Tri = {
    es: "Error: la tabla supera los 200 KB. Pide al usuario un archivo más pequeño.",
    en: "Error: the table exceeds 200 KB. Ask the user for a smaller file.",
    pt: "Erro: a tabela ultrapassa os 200 KB. Peça ao usuário um arquivo menor.",
  };
  const TABLE_PREFIX: Tri = {
    es: "No pude analizar la tabla: ",
    en: "I couldn't analyze the table: ",
    pt: "Não consegui analisar a tabela: ",
  };

  for (const lang of LANGS) {
    it(`analyze_table · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      // La salida del analizador es texto de su propia pieza (analyze.ts),
      // idéntica en los tres idiomas: se cobra como guardia.
      expect(await h["analyze_table"]({ text: "nombre,edad\nAna,30\nLuis,25" })).toBe(
        TABLE_OUT,
      );
      expect(await h["analyze_table"]({ text: "" })).toBe(TABLE_NO_TEXT[lang]);
      expect(await h["analyze_table"]({ text: "x".repeat(200 * 1024 + 1) })).toBe(
        TABLE_TOO_BIG[lang],
      );
      const bad = await h["analyze_table"]({ text: "a,b\n1,2", filter: "zz=1" });
      expect(bad.startsWith(TABLE_PREFIX[lang])).toBe(true);
    });
  }
});

// ------------------------------------------------------------------ Fase E

describe("paridad de salidas · mensajería NIDO", () => {
  // Re-asiento pedido por la cura de F-PC68 (tanda del mensajero
  // Fase E, como el Δ-1 de confirm.test.ts): el handler ya no
  // acepta destinatarios sin emparejar y el texto de la cola es el
  // verdadero; «Beto» se empareja una vez para todo el bloque.
  beforeAll(async () => {
    const m = getSharedNidoMessenger();
    const id = generateIdentity();
    const sign = generateIdentity();
    await m.pairWith(encodePairingPayload("Beto", id.publicKey, sign.publicKey));
  });

  const SEND_QUEUED: Record<RouterLang, (to: string) => string> = {
    es: (to) => `Mensaje para «${to}» guardado en la cola de salida de esta sesión, sin cifrar. Se queda ahí mientras la app esté abierta: en PC todavía no hay transporte NIDO a NIDO que lo entregue.`,
    en: (to) => `Message for “${to}” saved in this session's outbox, unencrypted. It stays there while the app is open: on PC there is no NIDO-to-NIDO transport yet to deliver it.`,
    pt: (to) => `Mensagem para “${to}” salva na fila de saída desta sessão, sem criptografia. Ela fica ali enquanto o app estiver aberto: no PC ainda não há transporte NIDO a NIDO que a entregue.`,
  };
  const SEND_NO_TO: Tri = {
    es: "Error: indica el nombre del contacto NIDO.",
    en: "Error: give the NIDO contact name.",
    pt: "Erro: indica o nome do contato NIDO.",
  };
  const SEND_NO_TEXT: Tri = {
    es: "Error: el mensaje está vacío.",
    en: "Error: the message is empty.",
    pt: "Erro: a mensagem está vazia.",
  };

  for (const lang of LANGS) {
    it(`nido_send_message · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      // Con el mensajero real en memoria y «Beto» emparejado (el
      // beforeAll del bloque), el mensaje queda en la cola de
      // salida (la planta P-MSG).
      expect(await h["nido_send_message"]({ to: "Beto", text: "hola Beto" })).toBe(
        SEND_QUEUED[lang]("Beto"),
      );
      expect(await h["nido_send_message"]({})).toBe(SEND_NO_TO[lang]);
      expect(await h["nido_send_message"]({ to: "Beto" })).toBe(SEND_NO_TEXT[lang]);
    });
  }

  const INBOX_EMPTY: Tri = {
    es: "No tienes mensajes NIDO sin leer.",
    en: "You have no unread NIDO messages.",
    pt: "Você não tem mensagens NIDO não lidas.",
  };

  for (const lang of LANGS) {
    it(`nido_read_inbox · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      expect(await h["nido_read_inbox"]({})).toBe(INBOX_EMPTY[lang]);
    });
  }

  const CODE_FRAME: Record<RouterLang, (code: string, fp: string) => string> = {
    es: (code, fp) => `Tu código de emparejamiento NIDO (muéstralo como QR para que el otro teléfono lo escanee):\n${code}\nHuella para verificar en persona: ${fp}`,
    en: (code, fp) => `Your NIDO pairing code (show it as a QR so the other phone can scan it):\n${code}\nFingerprint to verify in person: ${fp}`,
    pt: (code, fp) => `Seu código de emparelhamento NIDO (mostre-o como QR para que o outro telefone o escaneie):\n${code}\nImpressão digital para verificar em pessoa: ${fp}`,
  };

  for (const lang of LANGS) {
    it(`nido_my_code · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const m = getSharedNidoMessenger();
      const { fingerprint } = await m.ensureIdentity();
      const code = await m.myPairingCode();
      expect(await h["nido_my_code"]({})).toBe(CODE_FRAME[lang](code, fingerprint));
    });
  }

  const PAIR_OK: Record<RouterLang, (n: string) => string> = {
    es: (n) => `Contacto «${n}» emparejado, sin verificar todavía. Queda en tu lista de contactos de esta sesión. Para verificarlo, comparen la huella en persona.`,
    en: (n) => `Contact “${n}” paired, not verified yet. It stays in this session's contact list. To verify it, compare the fingerprint in person.`,
    pt: (n) => `Contato «${n}» emparelhado, ainda não verificado. Ele fica na sua lista de contatos desta sessão. Para verificar, comparem a impressão digital em pessoa.`,
  };
  const PAIR_NO_CODE: Tri = {
    es: "Error: falta el código del otro NIDO.",
    en: "Error: the other NIDO's code is missing.",
    pt: "Erro: falta o código do outro NIDO.",
  };
  const PAIR_PREFIX: Tri = {
    es: "No pude emparejar: ",
    en: "I couldn't pair: ",
    pt: "Não consegui emparelhar: ",
  };

  for (const lang of LANGS) {
    it(`nido_pair · ${lang}`, async () => {
      setHandlerLangForTest(lang);
      const h = H();
      const id = generateIdentity();
      const sign = generateIdentity();
      const name = `Par de paridad ${lang}`;
      const code = encodePairingPayload(name, id.publicKey, sign.publicKey);
      expect(await h["nido_pair"]({ code })).toBe(PAIR_OK[lang](name));
      expect(await h["nido_pair"]({})).toBe(PAIR_NO_CODE[lang]);
      const bad = await h["nido_pair"]({ code: "basura" });
      expect(bad.startsWith(PAIR_PREFIX[lang])).toBe(true);
    });
  }
});
