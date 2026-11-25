import { Elysia } from "elysia";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import type { authMacroPlugin } from "{{SCOPE}}/auth";
import { mediaParams, uploadMediaBody } from "./media.contract";
import { mediaServicePlugin, type ResolveStorage } from "./media.service";
import { R2Error } from "./storage";

/** The `auth` macro the routes guard themselves with: `authMacro` from the auth package, or one a test builds. */
export type AuthMacro = ReturnType<typeof authMacroPlugin>;

export function mediaRoutes(resolveStorage: ResolveStorage, macro: AuthMacro) {
  return (
    new Elysia({ name: "media.routes", prefix: "/media" })
      .use(macro)
      .use(mediaServicePlugin(resolveStorage))
      // Public route to serve the files (no auth required for viewing images)
      // Using * to capture the full path including slashes (e.g., "medias/nodes/uuid.png")
      .get("/file/*", async ({ params, query, mediaService, set }) => {
        try {
          // Decode URL-encoded characters in the key (e.g., %20 -> space, %C3%A9 -> é)
          const key = decodeURIComponent(params["*"]);
          const result = await mediaService.getFile(key, query);

          if (!result) {
            set.status = 404;
            return { error: "File not found" };
          }

          return new Response(result.blob, {
            headers: {
              "Content-Type": result.contentType,
              "Cache-Control": result.cacheControl,
              // The stored type is the detected one, and a browser must not second-guess it.
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          if (error instanceof R2Error && error.code === "INVALID_KEY") {
            set.status = 400;
            return { error: error.message, code: error.code };
          }
          throw error;
        }
      })
      .guard({ auth: true })
      .post(
        "/",
        async ({ body, mediaService, user, status }) => {
          const { file, folder = "uploads", organizationId, visibility } = body;

          try {
            return await mediaService.uploadMedia({
              file,
              folder,
              userId: user.id,
              organizationId,
              visibility,
            });
          } catch (error) {
            if (
              error instanceof R2Error &&
              (error.code === "INVALID_KEY" || error.code === "INVALID_FILE_TYPE")
            ) {
              return status(400, { error: error.message, code: error.code });
            }
            if (error instanceof R2Error && error.code === "UNAUTHORIZED") {
              return status(403, { error: error.message, code: error.code });
            }
            throw error;
          }
        },
        { body: uploadMediaBody },
      )
      .delete(
        "/:id",
        async ({ params, mediaService, user, set }) => {
          try {
            return await mediaService.deleteMedia({ id: params.id, userId: user.id });
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
                  set.status = 500;
                  return { error: error.message, code: error.code };
              }
            }

            throw error;
          }
        },
        { params: mediaParams },
      )
      .get(
        "/:id",
        async ({ params, mediaService, user, set }) => {
          const media = await mediaService.getMediaById(params.id, user.id);

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
