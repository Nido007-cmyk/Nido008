# Política de seguridad

NIDO PC está hecho para correr entero en tu propia máquina: sin
cuentas, sin telemetría, sin funciones en la nube, y tus datos
personales viven en una base local cifrada. Aun así, tomamos los
reportes de seguridad en serio y queremos saber de los problemas
antes de que puedan dañar a nadie.

## Cómo reportar una vulnerabilidad

Reporta las vulnerabilidades en privado, por el reporte privado
de vulnerabilidades de GitHub:

https://github.com/Nido007-cmyk/Nido008/security/advisories/new

No abras un issue público para una vulnerabilidad, y no publiques
detalles de explotación en ningún sitio público antes de que
exista el arreglo. No hay programa de recompensas ni pago por
reportes; lo que ofrecemos es el arreglo, el crédito en las notas
de la release si lo quieres, y las gracias.

## Ámbito

Dentro del ámbito, porque protegen los datos de tu máquina:

- El cifrado de la base local y el bloqueo por contraseña.
- La verificación de las descargas de modelos y paquetes de
  conocimiento (las huellas, la firma del manifiesto de los
  paquetes y la única vía de carga que los comprueba antes de que
  nada corra).
- Que la app abra un puerto a la escucha o haga conexiones de red
  fuera de las descargas que tú inicias.
- Todo lo que permita que un contenido dentro de la app (un
  documento, un paquete, un fichero de modelo) ejecute código o se
  salga de los límites de la propia app.

Fuera del ámbito:

- Los problemas que exigen acceso físico a una computadora
  desbloqueada, o malware que ya corre con los permisos de tu
  usuario.
- Que las respuestas del modelo de IA estén mal, sean groseras o
  no sirvan. Eso es un problema de calidad, no una vulnerabilidad;
  repórtalo como un bug, por favor.
- Las vulnerabilidades de componentes de terceros que no afectan
  a NIDO PC en la práctica; repórtalas en su proyecto, y avísanos
  también si NIDO PC trae una versión afectada.

## Versiones con soporte

NIDO PC está en desarrollo y todavía no se ha publicado ninguna
release pública. Cuando las haya, la versión con soporte será la
última, y los arreglos de seguridad llegarán ahí. En una versión
vieja, el arreglo es actualizar.

## Qué incluir en el reporte

- Qué es el problema y qué podría hacer un atacante con él.
- La versión de NIDO PC, tu sistema operativo y la clase de tu
  máquina si importa.
- Los pasos para reproducirlo, o una prueba de concepto, siempre
  en privado dentro del reporte.
- Lo que ya sepas de un arreglo, si sabes algo.

## Qué esperar de la respuesta

- Acusamos recibo de los reportes en un plazo de 5 días hábiles.
- Confirmamos si el reporte entra en el ámbito y te mantenemos al
  tanto mientras lo arreglamos.
- Los arreglos se coordinan contigo: acordamos juntos una fecha
  de publicación, y damos crédito a quien reporta en las notas de
  la release, salvo que prefiera quedar anónimo.

## Puerto seguro

Consideramos autorizada la investigación de seguridad hecha bajo
esta política. Si actúas de buena fe, evitas violar la privacidad
y interrumpir el servicio, y reportas lo que encuentres en
privado, no emprenderemos acciones legales por la investigación
en sí.

## Cómo está hecho NIDO PC para ser seguro

- **Sin superficie de red.** Después de las descargas que tú
  apruebas, la app no necesita red y no abre puertos a la escucha.
- **Solo descargas verificadas.** Cada modelo y cada paquete se
  comprueba por tamaño y huella SHA-256 contra el catálogo antes
  de que el motor nativo lo vea, por una única vía de carga.
- **Cifrado en reposo.** Tus conversaciones, notas,
  recordatorios, calendario, contactos y documentos viven en una
  base local cifrada. La clave sale de tu contraseña y no sale
  nunca de tu máquina.
- **Paquetes firmados.** La puerta de paquetes acepta solo los
  paquetes oficiales de NIDO y de SALVORA, verificados por huella
  y por la firma del manifiesto.
- **El agente pregunta primero.** Todo lo que cambia algo en tu
  máquina pasa por una confirmación explícita, y cada herramienta
  tiene su propio interruptor en Ajustes.

## La cadena de confianza de descargas y paquetes

Las releases se publicarán con un fichero `.sha256` para que
compruebes el instalador antes de correrlo. Los paquetes de
conocimiento se verifican igual dentro de la app, y un paquete
cuya huella o cuya firma no coincide se rechaza, nunca se abre.

## Reglas básicas

- Nunca publiques secretos, claves ni datos privados en un issue
  público.
- Sin recompensas, sin pago y sin publicación antes de la fecha
  coordinada.
- Trata este repositorio y sus releases con suavidad si usas
  escáneres automáticos; un reporte escrito a mano vale más que
  mil impactos de escáner.
