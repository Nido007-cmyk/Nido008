/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * toolPolicy.ts — Política configurable por herramienta
 * (tanda 13, acto 7 / pieza «política»).
 *
 * El motor de reglas (`policyEngine.evaluateAction`) es una
 * función pura de (herramienta, argumentos, contexto) sin
 * ninguna entrada de configuración: su único «no» duro es el
 * bloqueo por inyección, una señal de seguridad, no una
 * política. Este módulo es la puerta de entrada de la
 * política: una tabla por herramienta que el llamador (hoy,
 * solo el arnés de escenarios) entrega como dato inmutable
 * del turno, y una composición pura sobre la decisión del
 * motor.
 *
 * La composición es SOLO RESTRICTIVA, por construcción:
 * - Sin entrada para la herramienta, o con `AUTO`, la
 *   decisión vuelve idéntica. Un `AUTO` configurado no apaga
 *   la confirmación de una irreversible, no desbloquea una
 *   inyección y no abre ninguna puerta del motor.
 * - `ASK` solo puede añadir una confirmación a una decisión
 *   que ejecutaría sin ella.
 * - `DENY` deniega cualquier decisión que ejecutaría, con o
 *   sin confirmación pendiente: el DENY gana a la
 *   confirmación.
 * - Sobre una decisión bloqueada por el motor (seguridad)
 *   manda el bloqueo: la composición no lo re-etiqueta como
 *   denegación por configuración, para que el registro diga
 *   la verdad sobre por qué no se ejecutó.
 *
 * La decisión del motor no trae el nombre de la herramienta
 * (su interfaz no lo tiene): el nombre entra como parámetro
 * desde el llamador, que lo conoce por la validación. Y
 * ninguna decisión trae marca de «ya confirmada» —la
 * confirmación es flujo del despachador, no un campo—, así
 * que la composición siempre precede a toda confirmación.
 *
 * Nada aquí persiste ni es global: la tabla viaja en las
 * opciones del despacho y del bucle, por turno. Este módulo
 * es una hoja: no importa al despachador ni al bucle.
 */
import type { AuthDecision } from "./authorization.js";
import type { PolicyDecision } from "./policyEngine.js";

/**
 * El modo de política de una herramienta. Es el tipo
 * canónico del módulo de autorización (`AuthDecision`,
 * authorization.ts), importado como tipo: un solo
 * vocabulario de tres modos en todo el árbol.
 */
export type ToolPolicyMode = AuthDecision;

/** Tabla de política por nombre de herramienta. */
export type ToolPolicyTable = Readonly<Record<string, ToolPolicyMode>>;

/** El resultado de componer la política con la decisión. */
export interface ComposedToolPolicy {
  /** La decisión que el despacho consume. */
  decision: PolicyDecision;
  /**
   * Verdadero solo cuando la política configurada deniega
   * una decisión que el motor habría dejado ejecutar (con o
   * sin confirmación). Sobre un bloqueo del motor es falso:
   * el bloqueo de seguridad manda en el registro.
   */
  deniedByConfig: boolean;
}

/**
 * Compone la decisión del motor con la política configurada
 * para la herramienta nombrada. Pura: no muta la decisión
 * recibida (cuando la composición no cambia nada, devuelve
 * la misma referencia).
 */
export function composeToolPolicy(
  tool: string,
  decision: PolicyDecision,
  table: ToolPolicyTable | undefined
): ComposedToolPolicy {
  const mode = table?.[tool];
  if (mode === undefined || mode === "AUTO") {
    return { decision, deniedByConfig: false };
  }
  if (mode === "DENY") {
    if (!decision.allowed) {
      // Bloqueo de seguridad del motor: manda el bloqueo.
      return { decision, deniedByConfig: false };
    }
    return { decision, deniedByConfig: true };
  }
  // mode === "ASK": solo añade confirmación a lo que
  // ejecutaría sin ella; lo bloqueado y lo que ya la pide
  // quedan intactos.
  if (!decision.allowed || decision.requiresConfirmation) {
    return { decision, deniedByConfig: false };
  }
  return {
    decision: {
      ...decision,
      requiresConfirmation: true,
      reason: `${decision.reason} · confirmación exigida por la política configurada`,
    },
    deniedByConfig: false,
  };
}
