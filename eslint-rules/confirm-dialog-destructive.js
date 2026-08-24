// @ts-check
/**
 * Pattern audit #1: "a destructive dialog that is not marked destructive,
 * four lines from one that is" (ProductDetail.tsx's "Combine these
 * products?" said "This can't be undone from here" but had no `destructive`
 * prop, four lines above "Remove this barcode?", which did).
 *
 * Pins the INVARIANT, not the instance: any `<ConfirmDialog>` whose `title`
 * or `description` copy contains language that promises the action is
 * final/overwriting/irreversible must carry the `destructive` prop, so the
 * confirm button renders red. Structural (a JSX shape + string content), so
 * a lint rule catches the next instance instead of a review that only
 * checks the ones a person remembers to look at (the coordinator's own
 * "my conformance test missed a broken control for a day because it named
 * three specific consumers instead of asserting the invariant").
 */

/** Trigger phrases pulled from real copy already in the app for a genuinely
 * destructive ConfirmDialog (Plan.tsx's remove-from-plan, RecipeEditor.tsx/
 * IngredientEditor.tsx's stale-save overwrite, PantryItem.tsx's spoil) —
 * lower-cased, matched as plain substrings. */
const TRIGGER_PHRASES = [
  "can't be undone",
  "cannot be undone",
  "can't undo",
  "no longer",
  "overwrites",
  "overwritten",
  "permanently",
  "won't show here any more",
  "wont show here any more",
];

/** Recursively collects every string literal / template-literal chunk under an AST node. */
function collectStrings(node, out) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "Literal" && typeof node.value === "string") {
    out.push(node.value);
    return;
  }
  if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) out.push(quasi.value.cooked ?? "");
  }
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === "string") collectStrings(item, out);
      }
    } else if (value && typeof value.type === "string") {
      collectStrings(value, out);
    }
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the `destructive` prop on a ConfirmDialog whose copy promises an irreversible/overwriting action.",
    },
    schema: [],
    messages: {
      missingDestructive:
        'This ConfirmDialog\'s title/description implies a destructive action ("{{phrase}}") but has no `destructive` prop, so it renders the ordinary (non-red) confirm button. Add `destructive` — see ConfirmDialog.tsx and every other irreversible confirm in the app (pantry spoil, remove-from-plan, stale-save).',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "ConfirmDialog") return;

        const attributes = node.attributes.filter((a) => a.type === "JSXAttribute");
        const hasDestructive = attributes.some((a) => a.name.name === "destructive");
        if (hasDestructive) return;

        const strings = [];
        for (const attr of attributes) {
          if (attr.name.name === "title" || attr.name.name === "description") {
            collectStrings(attr.value, strings);
          }
        }
        const combined = strings.join(" ").toLowerCase();
        const phrase = TRIGGER_PHRASES.find((p) => combined.includes(p));
        if (phrase) {
          context.report({ node, messageId: "missingDestructive", data: { phrase } });
        }
      },
    };
  },
};

export default rule;
