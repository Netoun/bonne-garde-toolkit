import { t } from "elysia";

export const mediaParams = t.Object({ id: t.String() });

export const uploadMediaBody = t.Object({
  // The type is checked by the service, from the file's bytes: a `type` here would trust the declared one.
  file: t.File({ maxSize: "10m" }),
  folder: t.Optional(t.String()),
  organizationId: t.Optional(t.String()),
});

export const deleteMediaBody = t.Optional(
  t.Object({
    organizationId: t.Optional(t.String()),
  }),
);
