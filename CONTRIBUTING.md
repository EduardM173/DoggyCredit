# Contribuir a DoggyCredit

`main` representa el estado estable del proyecto. Cada sprint tiene una rama de integración y cada historia de usuario se desarrolla en su propia rama.

## Flujo de trabajo

1. Crea la rama del sprint desde `main` actualizado, por ejemplo `sprint/sprint-1`.
2. Crea cada HU desde la rama actualizada del sprint: `feature/hu-03-request-review`, `feature/hu-04-contracting`, etc. Mantén cada rama enfocada en su historia; usa `fix/<nombre-corto>` para correcciones.
3. Ejecuta `npm run lint`, `npm test` y `npm run build` antes de publicar.
4. Publica la rama de la HU y abre un Pull Request hacia la rama del sprint. Ejecuta las verificaciones antes de integrarla.
5. Al cerrar el sprint, abre un Pull Request desde la rama del sprint hacia `main` y espera que finalice el check `quality` de CI. No hagas push directo a `main`.

Excepción inicial: el trabajo acumulado de HU-01, HU-02 y HU-03 se consolidó en la rama de HU-03. Desde HU-04 se utiliza una rama separada por historia.

## Protección que debe aplicar un administrador

En GitHub, abre **Settings > Branches > Add branch protection rule** y usa el patrón `main`:

- activa **Require a pull request before merging**;
- activa **Require status checks to pass before merging** y selecciona `quality`;
- activa **Require branches to be up to date before merging**;
- activa **Do not allow bypassing the above settings** para bloquear también el push directo de administradores.

La protección vive en GitHub y no puede expresarse únicamente mediante archivos del repositorio.
