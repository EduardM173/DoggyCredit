# Contribuir a DoggyCredit

`main` representa el estado estable del proyecto. Todo cambio comienza desde una copia actualizada de esa rama.

## Flujo de trabajo

1. Crea `feature/<nombre-corto>` para funcionalidades o `fix/<nombre-corto>` para correcciones.
2. Mantén cada rama enfocada en un único cambio.
3. Ejecuta `npm run lint`, `npm test` y `npm run build` antes de publicar.
4. Abre un Pull Request hacia `main` y espera que finalice el check `quality` de CI.
5. Integra el cambio desde el Pull Request; no hagas push directo a `main`.

## Protección que debe aplicar un administrador

En GitHub, abre **Settings > Branches > Add branch protection rule** y usa el patrón `main`:

- activa **Require a pull request before merging**;
- activa **Require status checks to pass before merging** y selecciona `quality`;
- activa **Require branches to be up to date before merging**;
- activa **Do not allow bypassing the above settings** para bloquear también el push directo de administradores.

La protección vive en GitHub y no puede expresarse únicamente mediante archivos del repositorio.
