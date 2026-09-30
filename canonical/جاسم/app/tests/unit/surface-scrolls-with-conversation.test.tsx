/**
 * JASIM — THE GENERATED SURFACE SCROLLS WITH THE CONVERSATION.
 *
 * ─── WHAT WAS WRONG, MEASURED ───────────────────────────────────────────────
 *
 * The surface sat in a sibling drawer capped at `max-h-[38dvh]` — about 320px
 * on a 844px phone, barely one card — with its own `overflow-y-auto`. A rich
 * result could not occupy the space it needed, and the person scrolled a box
 * inside a box inside a chat.
 *
 *   CONVERSATION = PRIMARY SURFACE
 *   GENERATED UI = AN INSTRUMENT INSIDE IT, NOT A SECOND APPLICATION
 *
 * ─── AND WHAT MUST NOT BECOME TRUE WHILE FIXING IT ──────────────────────────
 *
 *   NEW DOMAIN != NEW COMPONENT · NEW EXAMPLE != NEW SCREEN
 *
 * No category navigation, no product home, no per-domain grid. The renderer
 * decides its columns from the SPACE IT WAS GIVEN, never from what the
 * entities are about.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Comments stripped, always.
 *
 * A rule is allowed to NAME what it forbids: the first version of this file
 * failed because a comment explaining «capped at 38dvh» is prose about the
 * defect, not the defect. A check that cannot tell the rule from the violation
 * forces the rule to be deleted in order to pass.
 */
const codeOnly = (path: string): string =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const home = () => codeOnly("src/pages/Home.tsx");
const chat = () => codeOnly("src/components/chat/JasimChat.tsx");
const workspace = () => codeOnly("src/components/jasim-core/ActiveGenerativeWorkspace.tsx");
const renderer = () => codeOnly("src/components/jasim-core/SchemaRenderer.tsx");

describe("the generated surface lives inside the conversation", () => {
  it("no global height cap traps a result any more", () => {
    //   GLOBAL_38DVH_RESULT_CAP_REMAINS = 0
    expect(home()).not.toContain("38dvh");
    // And the surface no longer scrolls inside itself.
    const body = workspace();
    const section = body.slice(body.indexOf('id="active-generative-workspace"'));
    expect(section.slice(0, section.indexOf("</section>"))).not.toContain("overflow-y-auto");
  });

  it("the surface is mounted in the conversation's own scroll flow, once", () => {
    const source = home();
    // Exactly one mount: two would be two queries and two scroll owners.
    expect(source.split("<ActiveGenerativeWorkspace").length - 1).toBe(1);
    // And it is handed to the conversation rather than placed beside it.
    expect(source).toMatch(/surface=\{[\s\S]{0,400}ActiveGenerativeWorkspace/);
    // The chat renders it inside its ScrollArea, not after it.
    const flow = chat();
    const scroll = flow.slice(flow.indexOf("<ScrollArea"), flow.indexOf("</ScrollArea>"));
    expect(scroll).toContain("{surface");
  });

  it("the rail keeps its cap and still reserves nothing when empty", () => {
    //   EMPTY_14DVH_SPACE_ALWAYS_RESERVED = 0
    //
    // Lifting the rail's cap made it grow to 503px on a 844px phone — more of
    // the screen than the thing it is secondary to. Only the instrument needed
    // its ceiling removed. Reserving nothing when empty was already true and is
    // what this asserts: the component returns null rather than an empty box.
    expect(home()).toContain("max-h-[14dvh]");
    expect(codeOnly("src/components/jasim-core/ActiveObjectsRail.tsx"))
      .toContain("if (objects.length === 0) return null;");
  });

  it("the grid decides its columns from space, never from a domain", () => {
    //   DOMAIN_LAYOUT_BRANCHES = 0
    const source = renderer();
    expect(source).toContain("repeat(auto-fill, minmax(min(100%, 17rem), 1fr))");
    // One card on a narrow phone falls out of `min(100%, …)`, not out of a rule
    // about what is being shown.
    // WHOLE WORDS. «car» lives inside `entity_card`, which is the runtime's own
    // vocabulary; a substring check called that a domain and was wrong.
    for (const domain of ["car", "food", "job", "hotel", "property", "vehicle",
      "restaurant", "flight", "catalog", "category"]) {
      expect(source, domain).not.toMatch(new RegExp(`\\b${domain}s?\\b`, "i"));
    }
    // And no second grid was created for anybody.
    expect(source).not.toMatch(/CarGrid|FoodGrid|JobGrid|PropertyGrid/);
  });

  it("no static category navigation was introduced", () => {
    //   STATIC_HOME_CATEGORY_NAV_ADDED = 0 · NEW EXAMPLE != NEW SCREEN
    const source = home();
    for (const nav of ["Cars", "Food", "Jobs", "Hotels", "سيارات", "مطاعم", "وظائف", "فنادق"]) {
      expect(source, nav).not.toContain(nav);
    }
    // Still one screen.
    expect(codeOnly("src/App.tsx")).not.toMatch(/Route|Router|Switch/);
  });

  it("a card's action still goes through the trusted path, not around it", () => {
    //   PRESENTATION_ACTION != EXECUTION_AUTHORITY
    const source = home();
    expect(source).toContain("dispatchWorkspaceAction");
    expect(source).toContain("createTrustedActionEnvelope");
    // Nothing on this path mutates directly.
    expect(renderer()).not.toMatch(/fetch\(|mutateAsync|trpc\./);
  });

  it("the picture rule is untouched", () => {
    //   SAFE_MEDIA_URL_REUSED
    const source = renderer();
    expect(source).toContain("safeMediaUrl(entity.image ?? entity.media)");
    expect(source).toContain("export function safeMediaUrl");
  });
});
