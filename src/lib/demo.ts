// Browser-local demo store (sample data only). Full demo workspace is pending.
import type { FormDefinition } from "./shared";
import type { SubmitResult } from "./api";

export function demoPublicForm(_id: string): FormDefinition | null {
  return null;
}

export async function demoSubmit(_id: string, _answers: Record<string, unknown>, _name?: string): Promise<SubmitResult> {
  return { ok: false, error: "The demo workspace isn't available yet." };
}
