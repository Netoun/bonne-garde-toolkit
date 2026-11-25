import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treaty } from "@elysiajs/eden";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { authMacroPlugin } from "{{SCOPE}}/auth";
// oxfmt-ignore
import * as authSchema from "{{SCOPE}}/auth/schema";
// oxfmt-ignore
import { createTestAuth } from "{{SCOPE}}/auth/testing";
import { MEDIA_DIR, createFsBucket, type MediaBucket } from "./bucket";
import { mediaPlugin } from "./media.module";
import * as storageSchema from "./schema";

/** The public url a test serves files under. */
export const TEST_PUBLIC_URL = "https://media.example.com";

/**
 * A real directory, under the system's temporary one: the `DATA_DIR` of a test, with its `media`
 * directory as the bucket. No stand-in, no mock. `empty()` clears the files between tests;
 * `dispose()` removes the directory.
 */
export async function startTestBucket() {
  const dataDir = await mkdtemp(join(tmpdir(), "storage-fs-"));
  const root = join(dataDir, MEDIA_DIR);
  return {
    dataDir,
    root,
    bucket: createFsBucket(root),
    empty: () => rm(root, { recursive: true, force: true }),
    dispose: () => rm(dataDir, { recursive: true, force: true }),
  };
}

/**
 * The media routes over a fresh in-memory SQLite database that has the auth and the media tables, a
 * real Better Auth instance for the sessions (`createTestAuth`, which owns the database and the
 * sign-in flow), and the bucket the test brings. Nothing is mocked: the requests go
 * through the plugin `apps/api` mounts, and what it stores lands in the database the test reads back.
 */
export async function createTestStorage<
  TTables extends Record<string, unknown> = Record<never, never>,
>(bucket: MediaBucket, tables?: TTables) {
  const { auth, db, signIn } = await createTestAuth({}, { ...storageSchema, ...tables });
  const app = new Elysia().use(
    mediaPlugin(
      async () => ({ db, bucket, publicUrl: TEST_PUBLIC_URL }),
      authMacroPlugin(async () => ({ auth, db })),
    ),
  );

  /** Signs a verified user up and in: its id, and the cookie of that session. */
  async function signUp(email: string) {
    const cookie = await signIn(email);
    const [created] = await db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, email));
    if (created === undefined) {
      throw new Error(`${email} signed in but has no user row`);
    }
    return { userId: created.id, cookie };
  }

  /** `userId` as a member of the organization `orgId`, with `role`. */
  async function addMember(orgId: string, userId: string, role: "owner" | "admin" | "member") {
    await db.insert(authSchema.member).values({
      id: `member-${orgId}-${userId}`,
      organizationId: orgId,
      userId,
      role,
      createdAt: new Date(),
    });
  }

  /** An organization with `userId` as a member of `role`. */
  async function addOrganization(id: string, userId: string, role: "owner" | "admin" | "member") {
    await db
      .insert(authSchema.organization)
      .values({ id, name: `Org ${id}`, slug: `org-${id}`, createdAt: new Date() });
    await addMember(id, userId, role);
  }

  /** The Eden client of the routes, signed in as the session `cookie` holds, or anonymous. */
  function client(cookie?: string) {
    return treaty(app, { headers: cookie === undefined ? {} : { cookie } });
  }

  return { app, db, auth, signUp, addMember, addOrganization, client };
}
