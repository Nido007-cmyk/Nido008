/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * native-modules.d.ts — DECLARACIONES AMBIENTALES (tanda 11, DET-11,
 * adaptación A-AMBIENTE asentada en la apertura).
 *
 * Las piezas recreadas de la capa determinista importan dinámicamente
 * los módulos nativos del móvil dentro de try/catch, con el texto
 * honesto de «no disponible» como conducta cuando el módulo falta.
 * Estas declaraciones existen SOLO para el typecheck: en ejecución
 * los módulos no están en PC, los imports fallan cerrado como en la
 * fuente, y las baterías que los ejercen los mockean con `vi.mock`.
 * Ninguna declaración aquí promete una capacidad real.
 */

declare module "react-native" {
  export const Linking: {
    openURL(url: string): Promise<void>;
  };
  export const Platform: { OS: string };
}

declare module "expo-calendar" {
  export function getCalendarPermissions(): Promise<{ granted: boolean; status: string }>;
  export function requestCalendarPermissions(): Promise<{ granted: boolean; status: string }>;
  export function getCalendars(): Promise<unknown[]>;
  export function listEvents(
    calendars: unknown[],
    from: Date,
    to: Date,
  ): Promise<Array<Record<string, unknown>>>;
}

declare module "expo-contacts" {
  export function getPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  export function requestPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  export const Contact: {
    getAllDetails(
      fields: readonly string[],
      opts?: { name?: string; limit?: number },
    ): Promise<unknown[]>;
  };
}

declare module "expo-document-picker" {
  export function getDocumentAsync(opts: {
    type: string;
    copyToCacheDirectory: boolean;
  }): Promise<{
    canceled: boolean;
    assets?: Array<{ uri: string; name?: string; size?: number }>;
  }>;
}

declare module "expo-file-system" {
  export class File {
    constructor(uri: string);
    arrayBuffer(): Promise<ArrayBuffer>;
  }
}

declare module "expo-sqlite" {
  // Solo aparece en mocks de baterías; la superficie real es de la
  // etapa de almacén, no de esta tanda.
  const _default: Record<string, unknown>;
  export default _default;
}

/** Global de React Native que las piezas de la fuente leen con guarda. */
declare var __DEV__: boolean | undefined;
