> **Idioma:** [English](README.md) · Español

<p align="center">
  <img src="app/public/mascot-nido.png" alt="Mascota de NIDO" width="120">
</p>

<h1 align="center">NIDO PC</h1>

<p align="center"><b>Tu agente, tu mundo, en tu computadora.</b><br>
Un asistente de IA privado para escritorio que funciona 100 % fuera de línea en tu propia máquina.</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia: MIT" src="https://img.shields.io/badge/licencia-MIT-green"></a>
  <a href="https://github.com/Nido007-cmyk/Nido008/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Nido007-cmyk/Nido008/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Plataforma: Windows" src="https://img.shields.io/badge/plataforma-Windows-3A563F">
</p>

NIDO PC es un asistente personal privado para escritorio que corre
modelos de lenguaje grandes en tu propia máquina, 100 % fuera de
línea después de la descarga inicial. Sin cuentas, sin telemetría,
sin nube. Tus conversaciones, notas, recordatorios y documentos
personales viven en una base local cifrada que solo abre tu
contraseña. Comparte el alma de la [app móvil de
NIDO](https://github.com/Nido007-cmyk/Nido) y suma lo que una
computadora desbloquea: modelos más grandes por defecto, contextos
largos y el catálogo completo de herramientas siempre presente.

**El modelo es para conversar. La ayuda no.**

> **En desarrollo.** NIDO PC no está terminado y todavía no hay
> ninguna versión pública. Este repositorio es su casa pública: el
> código se publica conforme se construye, como una foto del estado
> actual de desarrollo. Cuando la primera alfa esté lista, saldrá
> en [Releases](https://github.com/Nido007-cmyk/Nido008/releases)
> con su instalador y su huella de verificación.

## Qué hace hoy

- **Conversar con un modelo local grande.** Eliges en un catálogo
  de modelos abiertos según tu máquina, desde los pequeños y
  rápidos hasta los de clase 7B y 8B en las máquinas con memoria
  para ellos. NIDO te dice sin rodeos qué cabe en tu computadora y
  qué no.
- **Respuestas contrastadas con sus fuentes.** Un juez de
  fundamentación contrasta lo que el modelo afirma con las fuentes
  que tiene a mano, frase a frase, y cada respuesta lleva una
  insignia que dice cómo se comprobó.
- **Paquetes oficiales de conocimiento.** Los paquetes locales de
  conocimiento (los de NIDO y los de SALVORA, los mismos que usa la
  app móvil) responden desde contenido local verificado, sin red
  alguna.
- **Tus propios documentos.** Importas tus documentos y preguntas
  sobre ellos; las respuestas citan el documento y la página.
- **Investigación profunda.** Le das a NIDO una pregunta difícil
  y la descompone en subpreguntas, busca en tus paquetes de
  conocimiento y en tus documentos para cada una, y pasa cada
  afirmación por el juez de fundamentación antes de que te
  llegue. Ves el plan y su coste estimado antes de que corra
  nada, y puedes editarlo. El informe sale en cuatro estilos y
  queda guardado en la app, y si cierras NIDO a mitad de una
  investigación, la sesión se reanuda donde quedó cuando
  vuelves.
- **Memoria, calendario y recordatorios en tu máquina.** Lo que
  NIDO recuerda por ti, tu calendario y tus contactos viven dentro
  de la app, cifrados, y no se sincronizan con ningún sitio.
- **El calendario y los contactos se mueven contigo.** Importa y
  exporta tu calendario y tus contactos como ficheros estándar
  .ics y .vcf, con una vista previa de lo que va a cambiar antes
  de que se escriba nada.
- **Tareas programadas.** Creas tareas que corren más tarde o con
  un horario, dentro de la app, y lees sus resultados al volver.
- **Una guía integrada.** La sección Aprende, dentro de la
  Biblioteca, enseña cada función con ejemplos que se pueden tocar,
  escrita solo para lo que la app hace de verdad.
- **Voz en tu dispositivo.** Dictas tus mensajes y escuchas
  las respuestas en voz alta, en español, inglés y portugués,
  con modelos de voz que corren enteros en tu máquina.
- **Tres idiomas.** Toda la interfaz habla español, inglés y
  portugués.

## Míralo en video

Una primera mirada a NIDO PC funcionando, grabada durante el
desarrollo: el [video de adelanto](https://github.com/Nido007-cmyk/Nido008/issues/1),
en el primer issue de este repo (2 minutos).

## Instalación

Todavía no hay nada que instalar: no se publica ningún instalador
mientras la app está en desarrollo. La primera alfa saldrá como
instalador de Windows desde la página de Releases de este repo,
publicado junto a un fichero `.sha256` para que compruebes tu
descarga antes de abrirla:

```bat
certutil -hashfile NIDO-PC-Setup-0.1.0.exe SHA256
```

Windows enseñará un aviso de SmartScreen porque el instalador no
lleva certificado comercial de firma. Es lo esperado, y es una
decisión, no un descuido: NIDO PC es gratis y de código abierto, y
su garantía es el código a la vista y la huella que coincide, no
una firma comprada.

Hasta entonces, la forma de correr NIDO PC es compilarlo desde la
fuente, como sigue.

## Privacidad y seguridad

- Todo corre en tu máquina. Después de las descargas que tú
  apruebas (modelos y paquetes de conocimiento, cada una
  verificada por su huella), la app no necesita red y no abre
  puertos a la escucha.
- Sin cuentas, sin telemetría, sin analítica: nada llama a casa.
- Tus datos se guardan cifrados. Si pierdes la contraseña, los
  datos se pierden: no hay recuperación, por diseño.
- La declaración entera está en [PRIVACY.es.md](PRIVACY.es.md), y
  cómo reportar una vulnerabilidad en privado, en
  [SECURITY.es.md](SECURITY.es.md).

## Estado

NIDO PC está en desarrollo activo, versión 0.1.0. El código de este
repositorio es una foto de la rama de desarrollo tomada el
2026-11-23. Hoy funciona: el chat, el catálogo de modelos con sus
descargas verificadas, la memoria cifrada, el calendario, los
contactos y los recordatorios, la importación y exportación de
calendario y contactos en .ics y .vcf, las tareas programadas, la
biblioteca de documentos, la voz en el dispositivo (dictado y
lectura en voz alta), la investigación profunda con sus informes
guardados y la guía integrada. En desarrollo ahora mismo: la
última etapa de la primera versión, camino de la primera alfa.

En el último hito verificado, la batería de pruebas corrió 7.365
pruebas: 7.352 en verde, 13 fallos esperados y ningún fallo
inesperado.

NIDO PC es software en alfa temprana. Puede fallar, y va a
cambiar. Lo que cada versión promete es menos fallos que la
anterior, y unas notas de versión que digan sin rodeos qué
mejoró.

## NIDO en tu teléfono

NIDO también vive en Android, con la misma promesa: todo fuera de
línea, privado, sin cuentas. Consigue la release actual de Android,
[v0.1.112-alpha](https://github.com/Nido007-cmyk/Nido/releases/tag/v0.1.112-alpha),
en el repositorio móvil.

## Compilar desde la fuente

```sh
npm install
npm test            # la batería completa de pruebas (el núcleo, src/)
npm run typecheck   # revisión de tipos del núcleo
npm run catalog     # veredictos del catálogo por clase de máquina
npm run probe       # prueba de motor por terminal
```

La carcasa de escritorio vive en `app/`:

```sh
cd app
npm install
npm run typecheck
npm run build:vite  # compilar la app
npm run dist:dir    # empaquetarla, sin instalar, con electron-builder
```

La arquitectura pública vive en
[docs/es/ARCHITECTURE.md](docs/es/ARCHITECTURE.md). Las reglas
para contribuir están en
[CONTRIBUTING.es.md](CONTRIBUTING.es.md).

## Estructura del proyecto

- `src/`: el núcleo de la app (agente, recuperación,
  fundamentación, modelos, seguridad), lógica compartida sin
  código de plataforma.
- `app/`: la carcasa de escritorio (Electron), sus servicios y la
  interfaz.
- `scripts/`: los guiones públicos de construcción y verificación
  (el informe del catálogo, la prueba de motor y la biblioteca de
  paquetes que usan las pruebas).
- `knowledge-packs/`: los paquetes oficiales que esta app acepta.
- `assets/`: los paquetes incluidos y el corpus de recuperación
  con el que sale la app.
- `docs/`: la constitución y los principios del proyecto, y la
  arquitectura.

## Contribuir

Lo más útil ahora mismo son los reportes de errores y los comentarios de
quienes prueban la app. Usa las plantillas de issues: el propio «Reportar un
problema» de la app abre la misma puerta. Para código, lee antes
[CONTRIBUTING.es.md](CONTRIBUTING.es.md) y el
[código de conducta](CODE_OF_CONDUCT.es.md).

## Créditos y licencia

NIDO PC es código original, escrito desde cero para el escritorio,
bajo la licencia MIT propia de NIDO. La historia y las
atribuciones de la línea móvil viven en el repositorio móvil. Los
componentes de terceros conservan sus propias licencias, que se
listarán en el fichero de avisos de cada release cuando las
releases empiecen; los modelos de IA que descargas también
conservan las suyas, y la app nunca redistribuye
pesos de modelos: cada modelo lo descargas de su publicador.

MIT. Ver [LICENSE](LICENSE).

Copyright (c) 2026 NIDO contributors.
