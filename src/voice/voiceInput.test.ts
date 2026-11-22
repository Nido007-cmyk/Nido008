/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * voiceInput.test.ts — los casos heredados del móvil (auditoría
 * completa 2026-10-31, F1 M-4 y F6-07), recreados contra el
 * puerto del motor de PC: se simula el puerto con un registro
 * de oyentes propio, como allí se simulaba el módulo nativo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const portFake = vi.hoisted(() => {
  type Listener = (event: never) => void;
  const listeners = new Map<string, Set<Listener>>();
  const removed: string[] = [];
  return {
    listeners,
    removed,
    engineState: async () => "onDevice",
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(async () => {}),
    addListener(name: string, listener: Listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return {
        remove: () => {
          listeners.get(name)?.delete(listener);
          removed.push(name);
        },
      };
    },
    emit(name: string, event: unknown = {}) {
      for (const l of [...(listeners.get(name) ?? [])]) (l as (e: unknown) => void)(event);
    },
    listenerCount() {
      let n = 0;
      for (const s of listeners.values()) n += s.size;
      return n;
    },
    reset() {
      listeners.clear();
      removed.length = 0;
    },
  };
});

import { setVoiceEnginePort, startListening, type VoiceEvent } from "./voiceInput.js";

beforeEach(() => {
  portFake.reset();
  setVoiceEnginePort(portFake);
  vi.useFakeTimers();
});
afterEach(() => {
  setVoiceEnginePort(null);
  vi.useRealTimers();
});

describe("startListening (F1 M-4)", () => {
  it("un resultado normal resuelve con el texto y quita los oyentes", async () => {
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    portFake.emit("onSpeechStart");
    portFake.emit("onResults", { text: "hola mundo" });
    await expect(p).resolves.toBe("hola mundo");
    expect(events.map((e) => e.type)).toEqual(["start", "result"]);
    expect(portFake.listenerCount()).toBe(0);
  });

  it("el resultado que llega justo tras el fin de voz también vale (orden Android)", async () => {
    const p = startListening();
    portFake.emit("onSpeechEnd");
    portFake.emit("onResults", { text: "tarde pero válido" });
    await expect(p).resolves.toBe("tarde pero válido");
  });

  it("fin de voz sin resultado ni error: pasado el margen resuelve null y quita los oyentes", async () => {
    const events: VoiceEvent[] = [];
    const p = startListening((e) => events.push(e));
    portFake.emit("onSpeechEnd");
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toBeNull();
    expect(portFake.listenerCount()).toBe(0);
    // Un resultado tardío ya no alcanza a nadie: la sesión está muerta.
    portFake.emit("onResults", { text: "fantasma" });
    expect(events.map((e) => e.type)).toEqual(["end"]);
  });

  it("un error resuelve null y quita los oyentes", async () => {
    const p = startListening();
    portFake.emit("onError", { code: "7", message: "sin coincidencia" });
    await expect(p).resolves.toBeNull();
    expect(portFake.listenerCount()).toBe(0);
  });
});
