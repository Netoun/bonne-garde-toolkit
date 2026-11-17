import { describe, expect, test } from "bun:test";
import { askTemplate, resolveTemplate, TEMPLATES } from "./templates";

function unexpectedAsk(): never {
  throw new Error("asked, but the choice was already made");
}

describe("resolveTemplate", () => {
  test("takes --template over everything, without asking", async () => {
    expect(
      await resolveTemplate({
        flag: "dockerfile",
        yes: false,
        interactive: true,
        ask: unexpectedAsk,
      }),
    ).toBe("dockerfile");
  });

  test("refuses an unknown --template, naming the templates", async () => {
    const failure = await resolveTemplate({
      flag: "nope",
      yes: true,
      interactive: false,
      ask: unexpectedAsk,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    for (const { name } of TEMPLATES) {
      expect((failure as Error).message).toContain(name);
    }
  });

  test("is empty under --yes or without a TTY, without asking", async () => {
    expect(await resolveTemplate({ yes: true, interactive: true, ask: unexpectedAsk })).toBe(
      "empty",
    );
    expect(await resolveTemplate({ yes: false, interactive: false, ask: unexpectedAsk })).toBe(
      "empty",
    );
  });

  test("asks on a TTY without --yes", async () => {
    expect(await resolveTemplate({ yes: false, interactive: true, ask: () => "cloudflare" })).toBe(
      "cloudflare",
    );
  });
});

describe("askTemplate", () => {
  function answers(...lines: (string | null)[]) {
    const asked: string[] = [];
    const read = (question: string) => {
      asked.push(question);
      return lines.shift() ?? null;
    };
    return { read, asked };
  }

  test("takes a template by its number or its name", () => {
    const index = TEMPLATES.findIndex(({ name }) => name === "dockerfile");
    expect(askTemplate(answers(String(index + 1)).read)).toBe("dockerfile");
    expect(askTemplate(answers("cloudflare").read)).toBe("cloudflare");
  });

  test("takes empty on Enter or on end of input", () => {
    expect(askTemplate(answers("").read)).toBe("empty");
    expect(askTemplate(answers(null).read)).toBe("empty");
  });

  test("asks again after an answer that names no template", () => {
    const { read, asked } = answers("0", "nope", "cloudflare");
    expect(askTemplate(read)).toBe("cloudflare");
    expect(asked).toHaveLength(3);
  });
});

test("every template has a distinct name, and only empty installs nothing", () => {
  const names = TEMPLATES.map(({ name }) => name);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("empty");
  for (const { name, modules, items } of TEMPLATES) {
    expect(modules.length + items.length === 0).toBe(name === "empty");
  }
});
