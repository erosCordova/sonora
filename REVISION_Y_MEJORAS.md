# Revisión de Sonora

## Qué contiene el proyecto

Sonora es una plataforma web para describir canciones, guardar resultados y reproducirlos.
La aplicación usa PostgreSQL y un proceso independiente que conecta el motor musical ACE-Step.
El diseño incluye un modo simple, otro personalizado, biblioteca, favoritos y reproductor.

## Mejoras de esta revisión

1. **Instalación reproducible:** se añadió el archivo de versiones de las dependencias que necesitaba Docker.
2. **Preparación más sencilla:** `npm run setup` crea la configuración y las claves iniciales sin sobrescribir
   una configuración existente. La base de datos se toma de `DATABASE_URL`.
3. **Cola más segura:** una tarea reasignada ya no acepta progreso, errores ni audio de su intento anterior.
   Dos subidas simultáneas no pueden crear dos canciones para la misma tarea.
4. **Estados más claros:** la interfaz muestra si el motor musical está disponible y explica cuándo una canción
   tendrá que esperar. El seguimiento también consulta el estado cuando se interrumpe la conexión en vivo.
5. **Sesiones separadas:** al salir de la aplicación se cierra el seguimiento de tareas y se limpia el estado
   mostrado para evitar que se mezclen los datos de distintas sesiones en el navegador.
6. **Pruebas repetibles:** se incorporaron comprobaciones de integración para la cola y de comunicación del worker.

## Qué se comprobó

- Instalación de dependencias y compilación de la aplicación.
- Con PostgreSQL de prueba: registro, aislamiento, cola, cancelación, reintento, rechazo de un intento antiguo,
  dos subidas concurrentes y acceso parcial al archivo de audio.
- Protocolo del proceso de generación, usando un motor de prueba sin IA.

El audio utilizado durante las pruebas fue sintético y temporal. **Todavía no se ha generado una canción con
ACE-Step en esta revisión.** Es necesario configurar el motor, descargar sus pesos y comprobarlo en un equipo
compatible antes de valorar la calidad, duración, velocidad y edición reales. Tampoco se probó Docker aquí.

## Cómo empezar

Lee primero **README.md**, en la sección «Puesta en marcha local». También encontrarás una opción con Docker.
Para la primera prueba musical, prepara el worker como se indica allí y revisa la memoria y la GPU disponibles.

## Mejoras para publicación en GitHub (noviembre de 2026)

- Se añadió el workflow `.github/workflows/ci.yml` para verificar lint, TypeScript, compilación y pruebas del worker en cada push o pull request.
- Se corrigió un caso donde un fallo durante `engine.release()` podía derribar el worker después de procesar una canción. Ahora se registra el error y siempre se limpia el estado de la tarea.
- La recuperación de contraseña ya no usa las cabeceras `Host` o `X-Forwarded-Host` para formar enlaces con tokens. Requiere `APP_URL` válida en producción.
- El token de recuperación se consume atómicamente junto con el cambio de contraseña y el cierre de sesiones, impidiendo reutilización concurrente.
- Se añadieron pruebas del worker para cancelación y fallos de limpieza.

Las pruebas de integración completas requieren PostgreSQL local y el modelo ACE-Step real requiere una GPU disponible.
