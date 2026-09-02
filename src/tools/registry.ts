/**
 * The table a model acts through, and the boundary it cannot cross.
 *
 * This is what makes "the model never holds a handle" structural rather than a
 * policy someone has to remember. A tool's `execute` receives its context from
 * the runtime, not from the model; the model supplies arguments, and those are
 * parsed against the tool's schema before anything runs. It never holds a
 * database handle, never names a file path, and can only observe what a tool
 * chose to return.
 *
 * That inversion is also what lets an external provider drive the work without
 * being trusted with the data: whatever the model is, it acts through this
 * table or it does not act.
 *
 * The other half is `handles(names, context)`. A step declares the tools it
 * needs and is handed exactly those, so a capability cannot be talked into
 * reaching something it was not granted. Scoping at the step rather than at the
 * registry means one runtime serves a read-only extraction step and a
 * write-capable indexing step without maintaining two registries.
 */

import type { ToolContext, ToolDefinition, ToolHandle, ToolRegistry } from '../contracts/index.js';

/**
 * Heterogeneous by construction: each entry validates its own arguments on the
 * way in, which is where the type safety actually lives. The `any` is confined
 * to this line and never escapes into a signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ToolDefinition<any, unknown>;

/**
 * Pins `TInput` to the schema, so `execute` receives typed arguments without
 * every definition restating the type.
 */
export const defineTool = <TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> => definition;

export const createToolRegistry = (
  definitions: readonly AnyTool[] = []
): ToolRegistry => {
  const tools = new Map<string, AnyTool>();

  for (const definition of definitions) {
    // A duplicate name is a wiring mistake, and the later registration would
    // silently win. Which of two tools with one name a model reached is not a
    // question anyone should have to answer from a transcript.
    if (tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered.`);
    }

    tools.set(definition.name, definition);
  }

  return {
    names: () => [...tools.keys()],

    has: (name) => tools.has(name),

    handles(names: readonly string[], context: ToolContext): ToolHandle[] {
      return names.map((name) => {
        const tool = tools.get(name);

        if (!tool) {
          throw new Error(
            `Step requested unregistered tool "${name}". `
              + `Registered: ${[...tools.keys()].join(', ') || '(none)'}.`
          );
        }

        return {
          name,
          describe: tool.describe,
          inputSchema: tool.input,
          invoke: async (input: unknown) => {
            const parsed = tool.input.safeParse(input);

            // The model produced these arguments, so this is the boundary
            // check rather than a formality. The failure is returned, not
            // thrown: a model that guessed a field name can read the message
            // and correct itself on the next turn, where an exception would
            // end the run over a typo.
            if (!parsed.success) {
              return {
                error: `Invalid arguments for "${name}": ${parsed.error.issues
                  .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                  .join('; ')}`
              };
            }

            return tool.execute(parsed.data, context);
          }
        };
      });
    }
  };
};
