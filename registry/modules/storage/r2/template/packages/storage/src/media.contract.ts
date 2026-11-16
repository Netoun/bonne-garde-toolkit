import { t } from "elysia";
import { ALLOWED_IMAGE_TYPES } from "./r2";

export const mediaParams = t.Object({ id: t.String() });

export const uploadMediaBody = t.Object({
  file: t.File({ maxSize: "10m", type: ALLOWED_IMAGE_TYPES }),
  folder: t.Optional(t.String()),
  organizationId: t.Optional(t.String()),
});

export const deleteMediaBody = t.Optional(
  t.Object({
    organizationId: t.Optional(t.String()),
  }),
);
