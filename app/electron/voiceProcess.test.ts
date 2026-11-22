/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La espina de escucha de E9 (paso 1): los dos cargos de
 * conducta del gestor del proceso de voz, con un anfitrión
 * falso y un resolvedor de activos de mentira (las costuras
 * del gestor). La puerta con el anfitrión de verdad, dentro
 * de la carcasa real, la cobra el banco (escenario de voz).
 *
 *   1. Carga al pulsar y suelta al terminar: la sesión abre
 *      bifurcando una vez y cargando con las rutas del
 *      resolvedor; al cerrarse (aquí, por un segmento), el
 *      gestor manda soltar y la contabilidad dice no cargado.
 *   2. El corte del VAD llega al turno: el audio empujado
 *      sale hacia el anfitrión, su «speech-start» es el start
 *      de la sesión y su segmento cortado es, en orden, el
 *      fin y el resultado con su texto.
 */
import { describe, expect, it } from "vitest";

import {
  VoiceProcessManager,
  type VoiceHostHandle,
  type VoiceSessionEvent,
} from "./voiceProcess.ts";

class FakeHost implements VoiceHostHandle {
  posted: Record<string, unknown>[] = [];
  killed = false;
  private messageListener: ((m: Record<string, unknown>) => void) | null = null;
  private exitListener: ((code: number) => void) | null = null;

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
    if (message.type === "load") {
      queueMicrotask(() => this.deliver({ type: "loaded", rssMB: 700 }));
    }
    if (message.type === "release") {
      queueMicrotask(() => this.deliver({ type: "released", rssMB: 500 }));
    }
    if (message.type === "accounting") {
      queueMicrotask(() => this.deliver({ type: "rss", rssMB: 500 }));
    }
  }
  onMessage(listener: (m: Record<string, unknown>) => void): void {
    this.messageListener = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exitListener = listener;
  }
  kill(): void {
    this.killed = true;
  }
  deliver(message: Record<string, unknown>): void {
    this.messageListener?.(message);
  }
}

const resolveAssets = async () => ({
  parakeetDir: "/activos/parakeet-tdt-0.6b-v3-int8",
  vadFile: "/activos/silero_vad.onnx",
});

describe("el gestor del proceso de voz (E9 paso 1)", () => {
  it("la escucha se carga al pulsar y se suelta al terminar la sesión", async () => {
    const host = new FakeHost();
    let forks = 0;
    const manager = new VoiceProcessManager({
      assetsDir: "/activos",
      hostFactory: () => {
        forks++;
        return host;
      },
      resolveAssets,
    });
    await manager.startSession(() => {});
    expect(forks).toBe(1);
    expect(host.posted).toContainEqual({
      type: "load",
      parakeetDir: "/activos/parakeet-tdt-0.6b-v3-int8",
      vadFile: "/activos/silero_vad.onnx",
    });
    expect((await manager.accounting()).loaded).toBe(true);

    host.deliver({ type: "segment", text: "hola" });
    await new Promise((r) => setTimeout(r, 0));
    expect(host.posted.map((m) => m.type)).toContain("release");
    expect((await manager.accounting()).loaded).toBe(false);
    manager.dispose();
  });

  it("el VAD corta la frase y el corte llega como fin y resultado de la sesión", async () => {
    const host = new FakeHost();
    const manager = new VoiceProcessManager({
      assetsDir: "/activos",
      hostFactory: () => host,
      resolveAssets,
    });
    const events: VoiceSessionEvent[] = [];
    await manager.startSession((e) => events.push(e));
    manager.pushAudio(new Float32Array(512));
    expect(host.posted.map((m) => m.type)).toContain("audio");

    host.deliver({ type: "speech-start" });
    expect(events).toEqual([{ type: "start" }]);

    host.deliver({ type: "segment", text: "qué tiempo hace" });
    expect(events).toEqual([
      { type: "start" },
      { type: "end" },
      { type: "result", text: "qué tiempo hace" },
    ]);
    manager.dispose();
  });
});
