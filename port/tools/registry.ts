/**
 * The tools a model is allowed to use, and the boundary it cannot cross.
 *
 * This is the module that makes "user data stays local" a structural fact
 * rather than a policy someone has to remember. A tool's `execute` receives the
 * `RunContext` — and with it the store — from the runtime, not from the model.
 * The model supplies arguments, which are parsed against the tool's schema
 * before anything runs. It never holds a database handle, never names a file
 * path, and can only observe what a tool chose to return.
 *
 * That inversion is also what lets an external provider drive the work without
 * being trusted with the data: whatever the model is, it acts through this
 * table or it does not act.
 *
 * The other half is `toolSet(names, ...)`. A step declares the tools it needs
 * and the model is handed exactly those, so a capability cannot be talked into
 * reaching something it was not granted. Scoping at the step rather than the
 * registry means one runtime can serve a read-only extraction step and a
 * write-capable indexing step without two registries.
 */

import type { z } from 'zod';
import type { RunContext } from '../core/types.js';

export type ToolDefinition<TArgs = unknown> = {
  name: string;
  /** Shown to the model. Written for the model, not for the reader. */
  describe: string;
  schema: z.ZodType<TArgs>;
  execute: (args: TArgs, context: RunContext) => Promise<unknown>;
};

/**
 * Heterogeneous by construction; each entry validates its own arguments on the
 * way in, which is where the type safety actually lives.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDefinition = ToolDefinition<any>;

/**
 * Identity function that pins `TArgs` to the schema, so `execute` gets typed
 * arguments without every call site restating the type.
 */
export const defineTool = <TArgs>(
  definition: ToolDefinition<TArgs>
): ToolDefinition<TArgs> => definition;

export type ToolSet = Record<
  string,
  {
    description: string;
    inputSchema: z.ZodTypeAny;
    execute: (args: unknown) => Promise<unknown>;
  }
>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  constructor(definitions: AnyToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: AnyToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered.`);
    }
    this.tools.set(definition.name, definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Name and one-liner for each tool, for the planner and for diagnostics. */
  describe(): { name: string; describe: string }[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      describe: tool.describe
    }));
  }

  /**
   * Builds the SDK-shaped tool set for a step, binding the run context into
   * each `execute` so the model's arguments are the only thing it controls.
   *
   * An unknown name throws rather than being skipped: a step asking for a tool
   * that does not exist is a bug in the plan, and quietly running with fewer
   * tools than intended turns it into a confusing model failure later.
   */
  toolSet(names: string[], context: RunContext): ToolSet {
    const set: ToolSet = {};

    for (const name of names) {
      const tool = this.tools.get(name);

      if (!tool) {
        throw new Error(
          `Step requested unregistered tool "${name}". Registered: ${[...this.tools.keys()].join(', ')}.`
        );
      }

      set[name] = {
        description: tool.describe,
        inputSchema: tool.schema,
        execute: async (args: unknown) => {
          const parsed = tool.schema.safeParse(args);

          // The model produced these arguments, so this is the boundary check,
          // not a formality. Returning the error rather than throwing lets the
          // model correct itself on the next turn instead of failing the run.
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
    }

    return set;
  }
}
