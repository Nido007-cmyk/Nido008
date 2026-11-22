> **Idioma:** [English](../ARCHITECTURE.md) · Español

# Arquitectura de NIDO PC

Esta es la vista pública de cómo está hecho NIDO PC: las piezas,
el modelo de seguridad y la matemática de memoria que decide qué
modelos puede correr cada máquina. Describe el código de este
repositorio tal como está.

## La forma

NIDO PC tiene dos capas:

- **`src/` — el núcleo.** TypeScript sin plataforma: el bucle del
  agente, la capa determinista de herramientas, la recuperación
  sobre el conocimiento local, el juez de fundamentación, el
  catálogo de modelos y su matemática de memoria, los almacenes
  cifrados y las primitivas de seguridad. El núcleo no sabe nada
  del sistema operativo ni de la ventana en la que corre.
- **`app/` — la carcasa de escritorio.** Una app de Electron que
  aloja el núcleo: la puerta de la bóveda, las vistas (chat,
  biblioteca, agenda, modelos, ajustes), los servicios del sistema
  (notificaciones, bandeja, el reloj de las tareas programadas) y
  la única puerta verificada por la que los ficheros de modelos y
  paquetes entran en la máquina.

## El motor

La inferencia es llama.cpp a través de node-llama-cpp, con modelos
GGUF guardados en la propia máquina de la persona, binarios del
motor precompilados por plataforma y GPU (CUDA, Vulkan, Metal)
cuando la máquina la ofrece. Se carga un modelo cada vez; cambiar
de modelo libera el anterior.

## Si un modelo cabe se calcula, no se intuye

El conjunto de trabajo de un modelo se cuenta entero antes de
cargar nada:

```
conjunto de trabajo = pesos (el fichero entero)
                    + caché KV (2 × capas × contexto × cabezas KV × dimensión × bytes por elemento)
                    + búferes de cómputo
                    + logits
```

Enfrente está el presupuesto de la máquina: su memoria disponible
menos una reserva de máx(2 GiB, 20 % del total de RAM), con techo
de 8 GiB. Los techos de contexto siguen la clase de presupuesto:
32.768 tokens con un presupuesto de 8 GiB o más, 16.384 con 4 GiB
o más, 8.192 por debajo, con un suelo de 2.048. Si un modelo solo
cabe degradado, la app dice qué se degradó y por qué; si no cabe,
lo dice con las cifras a la vista. El veredicto al que llega la
vía de carga es el veredicto que la interfaz enseña. La
implementación vive en `src/core/ram.ts` y en
`src/inference/ramBudget.ts`.

## Modelo de seguridad

- **Sin red después de tus descargas.** La única red que la app
  usa es la descarga de modelos y paquetes de conocimiento que la
  persona inicia, cada una verificada antes de usarse. Sin
  cuentas, sin telemetría, sin analítica, sin comprobaciones de
  licencia en línea y sin puertos a la escucha (medido: cero
  sockets en todos los estados).
- **Una sola puerta verificada.** Cada fichero de modelo se
  comprueba por tamaño exacto y sha256 contra el catálogo en una
  única función (`src/core/loadPath.ts`) antes de que el
  analizador nativo vea un solo byte. Las descargas llegan a un
  fichero `.part`, se verifican y se renombran de forma atómica
  (`src/core/download.ts`). Ninguna URL llega nunca al motor.
- **Datos locales cifrados.** Conversaciones, notas,
  recordatorios, calendario, contactos y documentos personales
  viven en una base local cifrada (SQLCipher). La clave se deriva
  de la contraseña de la persona y no sale nunca de la máquina; no
  hay recuperación, por diseño.
- **Solo paquetes oficiales.** La puerta de paquetes acepta
  únicamente los paquetes oficiales de conocimiento de NIDO y de
  SALVORA, cada uno verificado por su huella y por la firma de su
  manifiesto.
- **El agente pregunta primero.** Las acciones que cambian algo
  pasan por una confirmación explícita, y cada herramienta que el
  agente puede usar tiene su propio interruptor en Ajustes.

## Conocimiento y fundamentación

Las respuestas se fundamentan en fuentes locales: los paquetes
oficiales de conocimiento, los documentos que la persona importa
y la propia memoria de la app. La recuperación usa un modelo de
embeddings multilingüe (multilingual-e5) fijado por huella, y un
juez de fundamentación contrasta lo que el modelo afirma con las
fuentes, frase a frase; cada respuesta lleva una insignia que dice
cómo se comprobó.

## Idiomas

La interfaz y la capa determinista hablan español, inglés y
portugués con paridad completa entre los tres: cada texto existe
en los tres, y las traducciones se escriben para que suenen
naturales en su propio idioma, nunca palabra por palabra.

## Pruebas

El núcleo lleva una batería completa de pruebas (Vitest) que corre
desde este repositorio (`npm test`), con pruebas negativas para
cada puerta de seguridad descrita arriba: un fichero de modelo
alterado en un solo byte se rechaza por su huella antes de que el
analizador corra. Lo que una máquina no puede ejecutar se declara
como no ejecutado, nunca se presenta como probado.

## Licencias

NIDO PC es MIT (ver [LICENSE](../../LICENSE)). llama.cpp y
node-llama-cpp son MIT. Cada modelo conserva su propia licencia,
enseñada en su ficha antes de descargarlo; la app nunca
redistribuye pesos de modelos.
