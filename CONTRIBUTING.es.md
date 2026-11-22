Idioma: [English](CONTRIBUTING.md) · Español

# Contribuir a NIDO PC

Gracias por querer ayudar. NIDO PC es un asistente de escritorio
con la privacidad primero: todo corre en la máquina de la persona,
fuera de línea, sin cuentas y sin telemetría. Las contribuciones
son bienvenidas cuando mantienen esa promesa intacta.

## Reglas de fondo

- **La privacidad no se negocia.** Ninguna función puede enviar
  datos de la persona a ningún sitio, añadir telemetría o
  analítica, ni exigir una cuenta. Si un cambio necesita red para
  algo más que las descargas que la persona aprueba expresamente
  (modelos y paquetes de conocimiento, verificados por huella), no
  tiene sitio aquí.
- **Sala limpia.** Este repositorio es código original bajo la
  licencia MIT propia de NIDO. No traigas código copiado de otros
  asistentes ni del historial del que parte la línea móvil. Las
  ideas y el comportamiento se pueden discutir; el código se
  escribe aquí.
- **Toda contribución llega bajo la licencia MIT** de este
  repositorio (ver [LICENSE](LICENSE)).
- **Los umbrales sellados se quedan sellados.** Las constantes de
  recuperación y fundamentación, la postura de seguridad y los
  formatos de datos solo cambian con un defecto medido, un cambio
  mínimo y una prueba de regresión que demuestre el arreglo.

## Cómo contribuir

1. Abre primero un issue para todo lo que pase de un arreglo
   pequeño, para que la forma del cambio se acuerde antes de
   escribir código.
2. Trabaja en una rama y abre un pull request contra `main`. Las
   versiones entran solo por pull request con el CI en verde.
3. Corre la batería antes de pedir revisión:

   ```sh
   npm install
   npm test
   npm run typecheck
   ```

4. En el pull request, di qué probaste, con qué evidencia, y qué
   queda sin probar. Que las pruebas salgan en verde no prueba por
   sí solo que un cambio funcione en una máquina real; dilo cuando
   sea el caso.

## Textos

- Todo texto visible para la persona sale en los tres idiomas de
  la app (español, inglés y portugués) en el mismo cambio. Las
  traducciones se escriben para que suenen naturales en su propio
  idioma, nunca palabra por palabra desde otro.
- Tono llano y humano: escribe como una persona, en primera
  persona cuando la app habla por sí misma, sin relleno de
  mercadotecnia.

## Cómo se tratan los reportes

Leemos todos los reportes. Todo lo que se puede arreglar se
arregla y entra en una versión posterior; no prometemos fechas.
Antes de cada versión, los reportes de fallos abiertos de este
repositorio se leen enteros: los que se pueden reproducir se
confirman contra la app y los arreglables entran en el trabajo de
esa versión. Si un reporte no se puede reproducir, pediremos el
dato que falta, y el propio formulario te dice cuál suele ser.

Para reportar un fallo, usa el formulario de reporte de bugs. La
propia app puede prepararte un resumen de diagnóstico: dentro de
la app, abre Ajustes, después Acerca de, y usa **Reportar un
problema**. La app prepara el texto en tu máquina y no envía nada;
tú lo revisas, lo copias y lo pegas en el formulario.

Las vulnerabilidades de seguridad nunca van en un issue público:
el canal privado está en [SECURITY.es.md](SECURITY.es.md).
