import { Elysia } from "elysia";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import type { authMacroPlugin } from "{{SCOPE}}/auth";
import { deleteMediaBody, mediaParams, uploadMediaBody } from "./media.contract";
import { mediaServicePlugin, type ResolveStorage } from "./media.service";
import { R2Error } from "./r2";

/** The `auth` macro the routes guard themselves with: `authMacro` from the auth package, or one a test builds. */
export type AuthMacro = ReturnType<typeof authMacroPlugin>;

export function mediaRoutes(resolveStorage: ResolveStorage, macro: AuthMacro) {
  return (
    new Elysia({ name: "media.routes", prefix: "/media" })
      .use(macro)
      .use(mediaServicePlugin(resolveStorage))
      // Public route to serve files from R2 (no auth required for viewing images)
      // Using * to capture the full path including slashes (e.g., "medias/nodes/uuid-filename.png")
      .get("/file/*", async ({ params, mediaService, set }) => {
        try {
          // Decode URL-encoded characters in the key (e.g., %20 -> space, %C3%A9 -> é)
          const key = decodeURIComponent(params["*"]);
          const result = await mediaService.getFileFromR2(key);

          if (!result) {
            set.status = 404;
            return { error: "File not found" };
          }

          return new Response(result.blob, {
            headers: {
              "Content-Type": result.contentType,
              "Cache-Control": "public, max-age=31536000", // Cache for 1 year
            },
          });
        } catch (error) {
          if (error instanceof R2Error && error.code === "INVALID_KEY") {
            set.status = 400;
            return { error: error.message, code: error.code };
          }
          if (error instanceof R2Error && error.code === "BUCKET_NOT_CONFIGURED") {
            set.status = 500;
            return { error: error.message, code: error.code };
          }
          throw error;
        }
      })
      .guard({ auth: true })
      .post(
        "/",
        async ({ body, mediaService, user, status }) => {
          const { file, folder = "uploads", organizationId } = body;

          try {
            return await mediaService.uploadMedia({
              file,
              folder,
              userId: user.id,
              organizationId,
            });
          } catch (error) {
            if (error instanceof R2Error && error.code === "INVALID_KEY") {
              return status(400, { error: error.message, code: error.code });
            }
            throw error;
          }
        },
        { body: uploadMediaBody },
      )
      .delete(
        "/:id",
        async ({ params, mediaService, user, body, set }) => {
          try {
            return await mediaService.deleteMedia({
              id: params.id,
              userId: user.id,
              organizationId: body?.organizationId,
            });
          } catch (error) {
            if (error instanceof R2Error) {
              switch (error.code) {
                case "MEDIA_NOT_FOUND":
                  set.status = 404;
                  return { error: error.message, code: error.code };
                case "UNAUTHORIZED":
                  set.status = 403;
                  return { error: error.message, code: error.code };
                case "MEDIA_IN_USE":
                  set.status = 409;
                  return { error: error.message, code: error.code };
                case "INVALID_FILE_TYPE":
                  set.status = 400;
                  return { error: error.message, code: error.code };
                case "FILE_TOO_LARGE":
                  set.status = 413;
                  return { error: error.message, code: error.code };
                case "R2_UPLOAD_FAILED":
                case "R2_DELETE_FAILED":
                case "BUCKET_NOT_CONFIGURED":
                  set.status = 500;
                  return { error: error.message, code: error.code };
              }
            }

            throw error;
          }
        },
        { params: mediaParams, body: deleteMediaBody },
      )
      .get(
        "/:id",
        async ({ params, mediaService, set }) => {
          const media = await mediaService.getMediaById(params.id);

          if (!media) {
            set.status = 404;
            return { error: "Media not found" };
          }

          return media;
        },
        { params: mediaParams },
      )
  );
}
